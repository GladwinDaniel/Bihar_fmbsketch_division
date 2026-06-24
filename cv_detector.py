import math
import requests
import numpy as np
import cv2
from PIL import Image
import io

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def num2deg(xtile, ytile, zoom):
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    lat_deg = math.degrees(lat_rad)
    return (lat_deg, lon_deg)

def fetch_satellite_image(min_lat, min_lon, max_lat, max_lon, zoom=19):
    xtile_min, ytile_max = deg2num(min_lat, min_lon, zoom)
    xtile_max, ytile_min = deg2num(max_lat, max_lon, zoom)
    
    # Cap tiles to avoid huge downloads if bbox is large
    if (xtile_max - xtile_min + 1) * (ytile_max - ytile_min + 1) > 25:
        zoom = 18
        xtile_min, ytile_max = deg2num(min_lat, min_lon, zoom)
        xtile_max, ytile_min = deg2num(max_lat, max_lon, zoom)

    width = (xtile_max - xtile_min + 1) * 256
    height = (ytile_max - ytile_min + 1) * 256
    
    stitched = Image.new('RGB', (width, height))
    
    headers = {"User-Agent": "BhuOverlay/1.0"}
    for x in range(xtile_min, xtile_max + 1):
        for y in range(ytile_min, ytile_max + 1):
            url = f"https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={zoom}"
            try:
                resp = requests.get(url, headers=headers, timeout=5)
                if resp.status_code == 200:
                    tile = Image.open(io.BytesIO(resp.content))
                    stitched.paste(tile, ((x - xtile_min) * 256, (y - ytile_min) * 256))
            except Exception as e:
                print(f"Failed to fetch tile {x},{y}: {e}")
                
    top_left_lat, top_left_lon = num2deg(xtile_min, ytile_min, zoom)
    bottom_right_lat, bottom_right_lon = num2deg(xtile_max + 1, ytile_max + 1, zoom)
    
    return np.array(stitched), top_left_lat, top_left_lon, bottom_right_lat, bottom_right_lon

def detect_features(bbox_str):
    # bbox_str is "south,west,north,east"
    parts = bbox_str.split(',')
    min_lat = float(parts[0])
    min_lon = float(parts[1])
    max_lat = float(parts[2])
    max_lon = float(parts[3])
    
    img_rgb, tl_lat, tl_lon, br_lat, br_lon = fetch_satellite_image(min_lat, min_lon, max_lat, max_lon)
    
    # Convert RGB (from Pillow) to BGR for OpenCV
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    img_h, img_w, _ = img_bgr.shape
    
    def pix2deg(x, y):
        lon = tl_lon + (x / img_w) * (br_lon - tl_lon)
        lat = tl_lat - (y / img_h) * (tl_lat - br_lat)
        return lat, lon

    elements = []
    node_id = 1
    
    # 1. Detect Trees (Green color)
    lower_green = np.array([35, 40, 40])
    upper_green = np.array([85, 255, 255])
    mask_green = cv2.inRange(hsv, lower_green, upper_green)
    
    # Morphological operations to clean up small noise
    kernel = np.ones((3,3), np.uint8)
    mask_green = cv2.morphologyEx(mask_green, cv2.MORPH_OPEN, kernel)
    
    contours, _ = cv2.findContours(mask_green, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area > 100 and area < 5000: # Filter by size
            M = cv2.moments(cnt)
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                lat, lon = pix2deg(cx, cy)
                elements.append({"type": "node", "id": node_id, "lat": lat, "lon": lon, "tags": {"natural": "tree"}})
                node_id += 1

    # 2. Detect Roads (Grey colors, linear features)
    lower_grey = np.array([0, 0, 50])
    upper_grey = np.array([180, 40, 200])
    mask_grey = cv2.inRange(hsv, lower_grey, upper_grey)
    
    mask_grey = cv2.morphologyEx(mask_grey, cv2.MORPH_OPEN, kernel)
    mask_grey = cv2.dilate(mask_grey, np.ones((5,5), np.uint8), iterations=1)
    
    edges = cv2.Canny(mask_grey, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, 50, minLineLength=50, maxLineGap=20)
    
    if lines is not None:
        way_id = 100000
        for line in lines:
            x1, y1, x2, y2 = line[0]
            lat1, lon1 = pix2deg(x1, y1)
            lat2, lon2 = pix2deg(x2, y2)
            n1 = node_id; node_id += 1
            n2 = node_id; node_id += 1
            elements.append({"type": "node", "id": n1, "lat": lat1, "lon": lon1})
            elements.append({"type": "node", "id": n2, "lat": lat2, "lon": lon2})
            elements.append({"type": "way", "id": way_id, "nodes": [n1, n2], "tags": {"highway": "unclassified"}})
            way_id += 1

    # Format exactly like Overpass API output
    osm_data = {
        "version": 0.6,
        "generator": "CV Detector",
        "elements": elements
    }
    
    return osm_data
