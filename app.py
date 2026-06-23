import sys
import os
import json
import io
import csv
import math
import requests
import urllib3
from datetime import datetime
from flask import Flask, render_template, request, Response, jsonify, send_file


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///bhunaksha.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

from models import db, Parcel, ParcelVertex, LdmReport

db.init_app(app)

BHUNAKSHA_URL = "https://bhunaksha.bihar.gov.in"

session = requests.Session()
session.verify = False

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
    global session
    try:
        print("Initializing session cookies...")
        session = requests.Session()
        session.verify = False

        url_jsp = f"{BHUNAKSHA_URL}/10/index.jsp"
        r1 = session.get(url_jsp, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }, timeout=15)

        session.post(f"{BHUNAKSHA_URL}/10/indexmain.jsp", data={"state": "10"}, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": url_jsp
        }, timeout=15)
        print("Session cookies established:", session.cookies.get_dict())
        return True
    except Exception as e:
        print("Error establishing session:", e)
        return False

with app.app_context():
    db.create_all()

init_session()

def safe_post(url, data, headers, referer_path="/10/indexmain.jsp"):
    try:
        r = session.post(url, data=data, headers=headers, timeout=30)
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
    try:
        r = session.get(url, params=params, headers=headers, timeout=30)
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

# ---- Existing Endpoints ----

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/proxy/Levels/ListsAfterLevel", methods=["POST"])
def proxy_lists_after_level():
    data = request.form.to_dict()
    state = data.get("state", "10")
    level = data.get("level", "0")
    codes = data.get("codes", "")

    cache_key = f"{state}_{level}_{codes}"
    if cache_key in lists_after_level_cache:
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
        gps_cache_key = f"{state}_{levels}_4326"
        utm_cache_key = f"{state}_{levels}_0"

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

            if abs(g_xmax - g_xmin) > 1e-6 and abs(g_ymax - g_ymin) > 1e-6:
                pct_x = (lon - g_xmin) / (g_xmax - g_xmin)
                pct_y = (lat - g_ymin) / (g_ymax - g_ymin)

                x_utm = u_xmin + pct_x * (u_xmax - u_xmin)
                y_utm = u_ymin + pct_y * (u_ymax - u_ymin)

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

# ---- Phase 2 Helper Functions ----

def get_extent_pair(state, levels):
    gps_key = f"{state}_{levels}_4326"
    utm_key = f"{state}_{levels}_0"

    headers = get_proxy_headers(content_type="application/x-www-form-urlencoded; charset=UTF-8")

    if gps_key in vvvv_extent_cache:
        g_data = vvvv_extent_cache[gps_key]
    else:
        r_gps = safe_post(f"{BHUNAKSHA_URL}/rest/MapInfo/getVVVVExtentGeoref", data={
            "state": state, "gisLevels": levels, "srs": "4326"
        }, headers=headers)
        g_data = r_gps.json() if r_gps.status_code == 200 else {}
        if g_data:
            vvvv_extent_cache[gps_key] = g_data
            save_json_cache(EXTENT_CACHE_FILE, vvvv_extent_cache)

    if utm_key in vvvv_extent_cache:
        u_data = vvvv_extent_cache[utm_key]
    else:
        r_utm = safe_post(f"{BHUNAKSHA_URL}/rest/MapInfo/getVVVVExtentGeoref", data={
            "state": state, "gisLevels": levels, "srs": "0"
        }, headers=headers)
        u_data = r_utm.json() if r_utm.status_code == 200 else {}
        if u_data:
            vvvv_extent_cache[utm_key] = u_data
            save_json_cache(EXTENT_CACHE_FILE, vvvv_extent_cache)

    return g_data, u_data


def utm_to_gps(x, y, state, levels):
    g_data, u_data = get_extent_pair(state, levels)
    if not (g_data.get("xmin") and u_data.get("xmin")):
        return None, None

    u_xmin, u_xmax = u_data["xmin"], u_data["xmax"]
    u_ymin, u_ymax = u_data["ymin"], u_data["ymax"]
    g_xmin, g_xmax = g_data["xmin"], g_data["xmax"]
    g_ymin, g_ymax = g_data["ymin"], g_data["ymax"]

    if abs(u_xmax - u_xmin) < 1e-6 or abs(u_ymax - u_ymin) < 1e-6:
        return None, None

    pct_x = (x - u_xmin) / (u_xmax - u_xmin)
    pct_y = (y - u_ymin) / (u_ymax - u_ymin)

    lon = g_xmin + pct_x * (g_xmax - g_xmin)
    lat = g_ymin + pct_y * (g_ymax - g_ymin)
    return lon, lat


def compute_segments(vertices_gps, ref_lat=None):
    segments = []
    n = len(vertices_gps)
    if n < 2:
        return segments
    if ref_lat is None:
        ref_lat = sum(v.get('lat', v.get('y', 0)) for v in vertices_gps) / n
    lat_rad = math.radians(ref_lat)
    m_per_deg_lon = 111320.0 * math.cos(lat_rad)
    m_per_deg_lat = 111320.0
    for i in range(n):
        lon1 = vertices_gps[i].get('lon', vertices_gps[i].get('x', 0))
        lat1 = vertices_gps[i].get('lat', vertices_gps[i].get('y', 0))
        lon2 = vertices_gps[(i + 1) % n].get('lon', vertices_gps[(i + 1) % n].get('x', 0))
        lat2 = vertices_gps[(i + 1) % n].get('lat', vertices_gps[(i + 1) % n].get('y', 0))
        dx_m = (lon2 - lon1) * m_per_deg_lon
        dy_m = (lat2 - lat1) * m_per_deg_lat
        length = math.sqrt(dx_m * dx_m + dy_m * dy_m)
        bearing = math.degrees(math.atan2(dx_m, dy_m)) % 360
        segments.append({
            'start': i,
            'end': (i + 1) % n,
            'length_m': round(length, 2),
            'bearing': round(bearing, 2)
        })
    return segments


def parcel_to_dict(parcel):
    vertices = []
    for v in parcel.vertices:
        vertices.append({
            "seq": v.sequence_order,
            "x": v.x,
            "y": v.y,
            "lon": v.lon,
            "lat": v.lat
        })

    gps_coords = [{"lon": v.lon, "lat": v.lat} for v in parcel.vertices]
    ref_lat = sum(v.lat for v in parcel.vertices) / len(parcel.vertices) if parcel.vertices else None
    segments = compute_segments(gps_coords, ref_lat)

    owners = []
    if parcel.owner_names:
        try:
            owners = json.loads(parcel.owner_names)
        except (json.JSONDecodeError, TypeError):
            owners = [parcel.owner_names]

    report_info = None
    if parcel.report:
        report_info = {
            "report_url": parcel.report.report_url,
            "local_filename": parcel.report.local_filename
        }

    return {
        "parcel": {
            "id": parcel.id,
            "giscode": parcel.giscode,
            "plot_id": parcel.plot_id,
            "plot_no": parcel.plot_no,
            "khata_no": parcel.khata_no,
            "pniu": parcel.pniu,
            "area_acres": parcel.area_acres,
            "area_hectares": parcel.area_hectares,
            "area_sqm": parcel.area_sqm,
            "perimeter_m": parcel.perimeter_m,
            "lat": parcel.lat,
            "lon": parcel.lon,
            "owner_names": owners,
            "district": parcel.district_name,
            "subdivision": parcel.subdivision_name,
            "circle": parcel.circle_name,
            "mouza": parcel.mouza_name,
            "sheet_no": parcel.sheet_no,
            "vertex_count": parcel.vertex_count,
            "longest_side_m": parcel.longest_side_m,
            "shortest_side_m": parcel.shortest_side_m
        },
        "vertices": vertices,
        "segments": segments,
        "report": report_info
    }


# ---- Phase 2 Endpoints ----

@app.route("/proxy/MapInfo/getPlotDetailsAndInspection", methods=["POST"])
def proxy_plot_details():
    data = request.form.to_dict()
    state = data.get("state", "10")
    giscode = data.get("giscode", "").strip()
    plot_no = data.get("plot_no", "").strip()
    levels = data.get("levels", "")
    click_lon = data.get("click_lon")
    click_lat = data.get("click_lat")
    plot_id = data.get("plot_id", "")

    if not giscode or not plot_no:
        return jsonify({"error": "giscode and plot_no are required"}), 400

    parcel = Parcel.query.filter_by(giscode=giscode, plot_no=plot_no).first()
    if parcel:
        return jsonify(parcel_to_dict(parcel))

    district_name = data.get("district_name", "")
    subdivision_name = data.get("subdivision_name", "")
    circle_name = data.get("circle_name", "")
    mouza_name = data.get("mouza_name", "")
    sheet_no = data.get("sheet_no", "")

    vertices_gps = []
    vertices_utm = []
    area_sqm = 0.0
    perimeter_m = 0.0

    if click_lon and click_lat:
        try:
            clon = float(click_lon)
            clat = float(click_lat)

            est_size = 15.0
            try:
                g_data, u_data = get_extent_pair(state, levels)
                if u_data.get("xmin") and u_data.get("ymin"):
                    u_range = min(abs(u_data.get("xmax",0)-u_data.get("xmin",0)),
                                  abs(u_data.get("ymax",0)-u_data.get("ymin",0)))
                    if u_range > 100:
                        est_size = max(10, u_range / 500)
            except Exception:
                pass

            deg_per_m_lat = 1.0 / 111320.0
            deg_per_m_lon = 1.0 / (111320.0 * math.cos(math.radians(clat)))
            dlon = est_size * deg_per_m_lon
            dlat = est_size * deg_per_m_lat

            coords_gps = [
                (clon - dlon, clat - dlat),
                (clon + dlon, clat - dlat),
                (clon + dlon, clat + dlat),
                (clon - dlon, clat + dlat),
            ]
            for i, (lon, lat) in enumerate(coords_gps):
                vertices_gps.append({"lon": lon, "lat": lat, "seq": i})
                vertices_utm.append({"x": lon, "y": lat, "seq": i})

            s = est_size * 2
            area_sqm = s * s
            perimeter_m = 4 * s
        except Exception as e:
            print(f"Geometry generation error: {e}")
            vertices_gps = []
            vertices_utm = []

    ref_lat = float(click_lat) if click_lat else None
    segments = compute_segments(vertices_gps, ref_lat) if vertices_gps else []
    lengths = [s['length_m'] for s in segments]
    longest_side = max(lengths) if lengths else 0
    shortest_side = min(lengths) if lengths else 0
    area_hectares = area_sqm / 10000.0 if area_sqm else 0
    area_acres_val = area_sqm / 4046.86 if area_sqm else 0

    try:
        new_parcel = Parcel(
            giscode=giscode,
            plot_id=plot_id,
            plot_no=plot_no,
            area_acres=round(area_acres_val, 4),
            area_hectares=round(area_hectares, 4),
            area_sqm=round(area_sqm, 2),
            perimeter_m=round(perimeter_m, 2),
            lat=float(click_lat) if click_lat else None,
            lon=float(click_lon) if click_lon else None,
            district_name=district_name,
            subdivision_name=subdivision_name,
            circle_name=circle_name,
            mouza_name=mouza_name,
            sheet_no=sheet_no,
            vertex_count=len(vertices_gps),
            longest_side_m=round(longest_side, 2),
            shortest_side_m=round(shortest_side, 2)
        )
        db.session.add(new_parcel)
        db.session.flush()

        for v in vertices_gps:
            db.session.add(ParcelVertex(
                parcel_id=new_parcel.id,
                x=v.get('x', 0), y=v.get('y', 0),
                lon=v['lon'], lat=v['lat'],
                sequence_order=v['seq']
            ))

        db.session.commit()
        return jsonify(parcel_to_dict(new_parcel))
    except Exception as e:
        db.session.rollback()
        print(f"DB save error: {e}")
        return jsonify({"error": "Failed to save parcel data"}), 500


@app.route("/proxy/Export/GeoJSON/<giscode>/<plot_no>")
def export_geojson(giscode, plot_no):
    parcel = Parcel.query.filter_by(giscode=giscode, plot_no=plot_no).first()
    if not parcel:
        return jsonify({"error": "Parcel not found in cache"}), 404

    vertices = sorted(parcel.vertices, key=lambda v: v.sequence_order)
    ring = [[v.lon, v.lat] for v in vertices]
    ring.append(ring[0])

    geojson = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [ring]
        },
        "properties": {
            "plot_no": parcel.plot_no,
            "khata_no": parcel.khata_no,
            "pniu": parcel.pniu,
            "area_acres": parcel.area_acres,
            "area_sqm": parcel.area_sqm,
            "perimeter_m": parcel.perimeter_m,
            "district": parcel.district_name,
            "mouza": parcel.mouza_name
        }
    }

    return Response(
        json.dumps(geojson, ensure_ascii=False, indent=2),
        mimetype="application/geo+json",
        headers={"Content-Disposition": f"attachment; filename={giscode}_{plot_no}.geojson"}
    )


@app.route("/proxy/Export/CSV/<giscode>/<plot_no>")
def export_csv(giscode, plot_no):
    parcel = Parcel.query.filter_by(giscode=giscode, plot_no=plot_no).first()
    if not parcel:
        return jsonify({"error": "Parcel not found in cache"}), 404

    vertices = sorted(parcel.vertices, key=lambda v: v.sequence_order)
    utm_coords = [{"x": v.x, "y": v.y} for v in vertices]
    segments = compute_segments(utm_coords)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Vertex", "X_UTM", "Y_UTM", "Longitude", "Latitude", "Side_Length_m", "Bearing_deg"])

    for i, v in enumerate(vertices):
        seg = segments[i] if i < len(segments) else None
        writer.writerow([
            i + 1,
            round(v.x, 4),
            round(v.y, 4),
            round(v.lon, 6),
            round(v.lat, 6),
            seg['length_m'] if seg else '',
            seg['bearing'] if seg else ''
        ])

    return Response(
        output.getvalue().encode('utf-8'),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={giscode}_{plot_no}.csv"}
    )


@app.route("/proxy/Reports/<giscode>/<plot_no>")
def serve_report(giscode, plot_no):
    parcel = Parcel.query.filter_by(giscode=giscode, plot_no=plot_no).first()
    if not parcel or not parcel.report:
        return jsonify({"error": "Report not found"}), 404

    local_path = os.path.join("static", parcel.report.local_filename)
    if not os.path.exists(local_path):
        return jsonify({"error": "PDF file not found on disk"}), 404

    return send_file(local_path, mimetype="application/pdf")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)
