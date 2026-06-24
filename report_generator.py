import os
import io
import tempfile
import cv2
import numpy as np
from fpdf import FPDF
from cv_detector import fetch_satellite_image

def generate_kurra_report(plot_no, parcel_vertices, features, subdivisions, frontage_coords, parcel_info=None):
    lats = [v[1] for v in parcel_vertices]
    lons = [v[0] for v in parcel_vertices]
    
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    
    # Add buffer
    lat_buffer = 0.0005
    lon_buffer = 0.0005
    
    img_rgb, tl_lat, tl_lon, br_lat, br_lon = fetch_satellite_image(
        min_lat - lat_buffer, min_lon - lon_buffer, max_lat + lat_buffer, max_lon + lon_buffer, zoom=19
    )
    
    img_h, img_w, _ = img_rgb.shape
    
    def deg2pix(lat, lon):
        x = int((lon - tl_lon) / (br_lon - tl_lon) * img_w)
        y = int((tl_lat - lat) / (tl_lat - br_lat) * img_h)
        return x, y

    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    
    # Draw Subdivisions
    overlay = img_bgr.copy()
    colors = [(200, 100, 100), (100, 200, 100), (100, 100, 200), (200, 200, 100), (200, 100, 200), (100, 200, 200)]
    
    if subdivisions:
        for i, sub in enumerate(subdivisions):
            coords = sub['geometry']['coordinates'][0]
            pts = np.array([deg2pix(lat, lon) for lon, lat in coords], np.int32)
            pts = pts.reshape((-1, 1, 2))
            color = colors[i % len(colors)]
            cv2.fillPoly(overlay, [pts], color)
        
        cv2.addWeighted(overlay, 0.3, img_bgr, 0.7, 0, img_bgr)
        
        # Draw subdivision outlines
        for i, sub in enumerate(subdivisions):
            coords = sub['geometry']['coordinates'][0]
            pts = np.array([deg2pix(lat, lon) for lon, lat in coords], np.int32)
            pts = pts.reshape((-1, 1, 2))
            color = colors[i % len(colors)]
            cv2.polylines(img_bgr, [pts], isClosed=True, color=color, thickness=2)
    
    # Draw original parcel outline
    pts = np.array([deg2pix(lat, lon) for lon, lat in parcel_vertices], np.int32).reshape((-1, 1, 2))
    cv2.polylines(img_bgr, [pts], isClosed=True, color=(0, 0, 255), thickness=3)
    
    # Draw Road Frontage
    if frontage_coords:
        pts = np.array([deg2pix(lat, lon) for lon, lat in frontage_coords], np.int32).reshape((-1, 1, 2))
        cv2.polylines(img_bgr, [pts], isClosed=False, color=(0, 255, 255), thickness=4)
        
    # Draw Features
    for feat in features:
        x, y = deg2pix(feat['y'], feat['x']) # x is lon, y is lat
        if feat['type'] == 'tree':
            color = (0, 255, 0) # Green
        elif feat['type'] == 'well':
            color = (255, 0, 0) # Blue
        else:
            color = (0, 165, 255) # Orange
        cv2.circle(img_bgr, (x, y), 7, color, -1)
        cv2.circle(img_bgr, (x, y), 7, (255, 255, 255), 2)

    fd, temp_img_path = tempfile.mkstemp(suffix='.jpg')
    os.close(fd)
    cv2.imwrite(temp_img_path, img_bgr)
    
    # PDF Generation
    pdf = FPDF()
    pdf.add_page()
    
    pdf.set_font("helvetica", 'B', 16)
    pdf.cell(0, 10, f"Land Division (Kurra) Report - Plot {plot_no}", new_x="LMARGIN", new_y="NEXT", align='C')
    pdf.ln(5)
    
    if parcel_info:
        pdf.set_font("helvetica", 'B', 12)
        pdf.cell(0, 8, "Land Parcel Information", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("helvetica", size=10)
        
        info_str = f"District: {parcel_info.get('district_name', 'N/A')} | " \
                   f"Sub-Division: {parcel_info.get('subdiv_name', 'N/A')} | " \
                   f"Circle: {parcel_info.get('circle_name', 'N/A')} | " \
                   f"Mouza: {parcel_info.get('mouza_name', 'N/A')}"
        pdf.cell(0, 6, info_str, new_x="LMARGIN", new_y="NEXT")
        
        area = parcel_info.get('area_sqm', 0)
        area_str = f"Total Area: {area/4046.8564:.3f} acres ({area:.1f} sq.m)"
        pdf.cell(0, 6, area_str, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(5)
    
    pdf.image(temp_img_path, x=15, w=180)
    pdf.ln(5)
    
    # Map Legend
    pdf.set_font("helvetica", 'I', 9)
    pdf.cell(0, 6, "Legend: Red = Parcel Boundary, Yellow = Road Frontage, Green Dot = Tree, Blue Dot = Well", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    
    if subdivisions:
        pdf.set_font("helvetica", 'B', 12)
        pdf.cell(0, 10, "Segregation Details", new_x="LMARGIN", new_y="NEXT")
        
        pdf.set_font("helvetica", size=10)
        for i, sub in enumerate(subdivisions):
            props = sub['properties']
            pdf.set_font("helvetica", 'B', 10)
            pdf.cell(0, 8, f"Sub-Plot {props['sub_plot_id']} ({props['share_percentage']:.1f}%)", new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("helvetica", size=10)
            pdf.cell(0, 6, f"Area: {props['area_sqm']/4046.8564:.3f} acres ({props['area_sqm']:.1f} sq.m)", new_x="LMARGIN", new_y="NEXT")
            pdf.cell(0, 6, f"Perimeter: {props['perimeter_m']:.1f} m", new_x="LMARGIN", new_y="NEXT")
            if props.get('frontage_m'):
                pdf.cell(0, 6, f"Road Frontage Extent: {props['frontage_m']:.1f} m", new_x="LMARGIN", new_y="NEXT")
                
            feats = props.get('contained_features', [])
            if feats:
                feat_types = [f['type'].capitalize() for f in feats]
                pdf.cell(0, 6, f"Features inside plot: {', '.join(feat_types)}", new_x="LMARGIN", new_y="NEXT")
            else:
                pdf.cell(0, 6, "Features inside plot: None", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(3)

    os.unlink(temp_img_path)
    return pdf.output()
