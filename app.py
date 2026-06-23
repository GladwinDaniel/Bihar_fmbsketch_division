import sys
import os
import json
import requests
import urllib3
from flask import Flask, render_template, request, Response, jsonify

# Disable insecure request warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)

BHUNAKSHA_URL = "https://bhunaksha.bihar.gov.in"

# Global session to maintain cookies
session = requests.Session()
session.verify = False

# Persistent cache files
DROPDOWN_CACHE_FILE = "dropdown_cache.json"
EXTENT_CACHE_FILE = "extent_cache.json"

def load_json_cache(filename):
    try:
        if os.path.exists(filename):
            with open(filename, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading cache file {filename}: {e}")
    return {}

def save_json_cache(filename, data):
    try:
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving cache file {filename}: {e}")

lists_after_level_cache = load_json_cache(DROPDOWN_CACHE_FILE)
vvvv_extent_cache = load_json_cache(EXTENT_CACHE_FILE)

def init_session():
    """Establishes the session cookies with BhuNaksha."""
    global session
    try:
        print("Initializing session cookies...")
        # Start a fresh session
        session = requests.Session()
        session.verify = False
        
        # Get landing page to establish cookies (using index.jsp for speed and reliability)
        url_jsp = f"{BHUNAKSHA_URL}/10/index.jsp"
        r1 = session.get(url_jsp, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }, timeout=15)
        
        # Load main page to make sure session state is fully active
        session.post(f"{BHUNAKSHA_URL}/10/indexmain.jsp", data={"state": "10"}, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": url_jsp
        }, timeout=15)
        print("Session cookies established:", session.cookies.get_dict())
        return True
    except Exception as e:
        print("Error establishing session:", e)
        return False

# Initialize on startup
init_session()

def safe_post(url, data, headers, referer_path="/10/indexmain.jsp"):
    """Performs a POST request, self-healing session if it fails or returns error. Increased timeout to 30s."""
    try:
        r = session.post(url, data=data, headers=headers, timeout=30)
        # Check if response is HTML (redirects/session expiry) when we expect REST JSON/text
        is_html_error = r.headers.get("Content-Type", "").startswith("text/html") or r.text.strip().startswith("<")
        if r.status_code in [401, 403, 500] or "Error" in r.text[:200] or is_html_error:
            print(f"Warning: POST {url} returned {r.status_code} (HTML/Error). Re-initializing session...")
            if init_session():
                headers["Referer"] = f"{BHUNAKSHA_URL}{referer_path}"
                r = session.post(url, data=data, headers=headers, timeout=30)
        return r
    except Exception as e:
        print(f"Exception on POST {url}: {e}. Retrying with fresh session...")
        if init_session():
            headers["Referer"] = f"{BHUNAKSHA_URL}{referer_path}"
            return session.post(url, data=data, headers=headers, timeout=30)
        raise e

def safe_get(url, params, headers):
    """Performs a GET request, self-healing session if it fails or returns error. Increased timeout to 30s."""
    try:
        r = session.get(url, params=params, headers=headers, timeout=30)
        # Check if response is HTML (redirects/session expiry) when we expect REST/WMS data
        is_html_error = r.headers.get("Content-Type", "").startswith("text/html") or r.text.strip().startswith("<")
        if r.status_code in [401, 403, 500] or "Error" in r.text[:200] or is_html_error:
            print(f"Warning: GET {url} returned {r.status_code} (HTML/Error). Re-initializing session...")
            if init_session():
                r = session.get(url, params=params, headers=headers, timeout=30)
        return r
    except Exception as e:
        print(f"Exception on GET {url}: {e}. Retrying with fresh session...")
        if init_session():
            return session.get(url, params=params, headers=headers, timeout=30)
        raise e

def get_proxy_headers(referer_path="/10/indexmain.jsp", content_type=None):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": f"{BHUNAKSHA_URL}{referer_path}",
        "X-Requested-With": "XMLHttpRequest"
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/proxy/Levels/ListsAfterLevel", methods=["POST"])
def proxy_lists_after_level():
    data = request.form.to_dict()
    state = data.get("state", "10")
    level = data.get("level", "0")
    codes = data.get("codes", "")
    
    # Check cache
    cache_key = f"{state}_{level}_{codes}"
    if cache_key in lists_after_level_cache:
        # Serve immediately from cache
        return jsonify(lists_after_level_cache[cache_key])
        
    url = f"{BHUNAKSHA_URL}/rest/Levels/ListsAfterLevel"
    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")
    try:
        r = safe_post(url, data=data, headers=headers)
        if r.status_code == 200:
            try:
                json_data = r.json()
                lists_after_level_cache[cache_key] = json_data
                save_json_cache(DROPDOWN_CACHE_FILE, lists_after_level_cache)
                return jsonify(json_data)
            except:
                pass
        return Response(r.text, status=r.status_code, content_type=r.headers.get("Content-Type"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/proxy/MapInfo/getVVVVExtentGeoref", methods=["POST"])
def proxy_extent():
    data = request.form.to_dict()
    state = data.get("state", "10")
    gis_levels = data.get("gisLevels", "")
    srs = data.get("srs", "4326")
    
    # Check cache
    cache_key = f"{state}_{gis_levels}_{srs}"
    if cache_key in vvvv_extent_cache:
        return jsonify(vvvv_extent_cache[cache_key])
        
    url = f"{BHUNAKSHA_URL}/rest/MapInfo/getVVVVExtentGeoref"
    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")
    try:
        r = safe_post(url, data=data, headers=headers)
        if r.status_code == 200:
            try:
                json_data = r.json()
                vvvv_extent_cache[cache_key] = json_data
                save_json_cache(EXTENT_CACHE_FILE, vvvv_extent_cache)
                return jsonify(json_data)
            except:
                pass
        return Response(r.text, status=r.status_code, content_type=r.headers.get("Content-Type"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/proxy/MapInfo/getPlotAtXY", methods=["POST"])
def proxy_plot_at_xy():
    url = f"{BHUNAKSHA_URL}/rest/MapInfo/getPlotAtXY"
    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")
    data = request.form.to_dict()
    try:
        r = safe_post(url, data=data, headers=headers)
        return Response(r.text, status=r.status_code, content_type=r.headers.get("Content-Type"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/proxy/MapInfo/getPlotAtGPS", methods=["POST"])
def get_plot_at_gps():
    """Converts input GPS coordinate [lon, lat] to local village UTM coordinates using 
       bounding box interpolation, then calls the getPlotAtXY REST endpoint."""
    data = request.form.to_dict()
    state = data.get("state", "10")
    giscode = data.get("giscode")
    levels = data.get("levels")
    
    try:
        lon = float(data.get("lon"))
        lat = float(data.get("lat"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid coordinate inputs"}), 400
        
    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")
    
    try:
        # Check cache for extent maps
        gps_cache_key = f"{state}_{levels}_4326"
        utm_cache_key = f"{state}_{levels}_0"
        
        # 1. Fetch GPS extent (srs: 4326)
        if gps_cache_key in vvvv_extent_cache:
            g_data = vvvv_extent_cache[gps_cache_key]
        else:
            r_gps = safe_post(f"{BHUNAKSHA_URL}/rest/MapInfo/getVVVVExtentGeoref", data={
                "state": state,
                "gisLevels": levels,
                "srs": "4326"
            }, headers=headers)
            g_data = r_gps.json() if r_gps.status_code == 200 else {}
            if g_data:
                vvvv_extent_cache[gps_cache_key] = g_data
                save_json_cache(EXTENT_CACHE_FILE, vvvv_extent_cache)
        
        # 2. Fetch UTM extent (srs: 0)
        if utm_cache_key in vvvv_extent_cache:
            u_data = vvvv_extent_cache[utm_cache_key]
        else:
            r_utm = safe_post(f"{BHUNAKSHA_URL}/rest/MapInfo/getVVVVExtentGeoref", data={
                "state": state,
                "gisLevels": levels,
                "srs": "0"
            }, headers=headers)
            u_data = r_utm.json() if r_utm.status_code == 200 else {}
            if u_data:
                vvvv_extent_cache[utm_cache_key] = u_data
                save_json_cache(EXTENT_CACHE_FILE, vvvv_extent_cache)
        
        if g_data.get("xmin") and u_data.get("xmin"):
            g_xmin, g_xmax = g_data["xmin"], g_data["xmax"]
            g_ymin, g_ymax = g_data["ymin"], g_data["ymax"]
            
            u_xmin, u_xmax = u_data["xmin"], u_data["xmax"]
            u_ymin, u_ymax = u_data["ymin"], u_data["ymax"]
            
            # Check for standard valid coordinate box sizes to avoid divide by zero
            if abs(g_xmax - g_xmin) > 1e-6 and abs(g_ymax - g_ymin) > 1e-6:
                pct_x = (lon - g_xmin) / (g_xmax - g_xmin)
                pct_y = (lat - g_ymin) / (g_ymax - g_ymin)
                
                x_utm = u_xmin + pct_x * (u_xmax - u_xmin)
                y_utm = u_ymin + pct_y * (u_ymax - u_ymin)
                
                # 3. Call getPlotAtXY with native UTM coordinates
                url_plot = f"{BHUNAKSHA_URL}/rest/MapInfo/getPlotAtXY"
                r_plot = safe_post(url_plot, data={
                    "state": state,
                    "giscode": giscode,
                    "x": str(x_utm),
                    "y": str(y_utm)
                }, headers=headers)
                
                return Response(r_plot.text, status=r_plot.status_code, content_type=r_plot.headers.get("Content-Type"))
                    
        return jsonify({"error": "Failed to map extent coordinates"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/proxy/MapInfo/getPointsfromPNIU", methods=["POST"])
def proxy_pniu_points():
    url = f"{BHUNAKSHA_URL}/rest/MapInfo/getPointsfromPNIU"
    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")
    data = request.form.to_dict()
    try:
        r = safe_post(url, data=data, headers=headers)
        return Response(r.text, status=r.status_code, content_type=r.headers.get("Content-Type"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/proxy/MapInfo/getGisCode", methods=["POST"])
def proxy_giscode():
    url = f"{BHUNAKSHA_URL}/rest/MapInfo/getGisCode"
    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")
    data = request.form.to_dict()
    try:
        r = safe_post(url, data=data, headers=headers)
        return Response(r.text, status=r.status_code, content_type=r.headers.get("Content-Type"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/proxy/WMS", methods=["GET"])
def proxy_wms():
    url = f"{BHUNAKSHA_URL}/WMS"
    headers = get_proxy_headers()
    params = request.args.to_dict()
    try:
        r = safe_get(url, params=params, headers=headers)
        return Response(r.content, status=r.status_code, content_type=r.headers.get("Content-Type"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)
