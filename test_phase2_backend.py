"""
Phase 2 verification tests: models, helpers, Flask routes.
Run: python -m pytest test_phase2_backend.py -v
"""

import os
import sys
import json
import pytest

os.environ['FLASK_ENV'] = 'testing'


@pytest.fixture(scope="module")
def app():
    from app import app as flask_app
    flask_app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    flask_app.config['TESTING'] = True
    from models import db
    with flask_app.app_context():
        db.create_all()
    return flask_app


@pytest.fixture(scope="module")
def client(app):
    return app.test_client()


@pytest.fixture
def db_session(app):
    from models import db
    with app.app_context():
        yield db


# ── Test 1: Module imports ──

def test_imports():
    import shapely
    import sqlalchemy
    from bs4 import BeautifulSoup
    assert shapely.__version__
    assert sqlalchemy.__version__
    assert BeautifulSoup


# ── Test 2: Database tables exist ──

def test_db_tables_exist(app):
    from models import db
    with app.app_context():
        conn = db.engine.connect()
        assert db.engine.dialect.has_table(conn, 'parcels')
        assert db.engine.dialect.has_table(conn, 'parcel_vertices')
        assert db.engine.dialect.has_table(conn, 'ldm_reports')
        conn.close()


# ── Test 3: Parcel insert, query, cascade delete ──

def test_parcel_crud(app):
    from models import db, Parcel, ParcelVertex, LdmReport

    with app.app_context():
        parcel = Parcel(
            giscode="10_test",
            plot_id="456",
            plot_no="789",
            khata_no="KH-001",
            pniu="12345678901234",
            area_acres=1.5,
            area_hectares=0.607,
            area_sqm=6070.0,
            perimeter_m=320.5,
            lat=25.5,
            lon=85.1,
            owner_names='["Ram Singh", "Shyam Singh"]',
            district_name="Patna",
            circle_name="Patna Sadar",
            mouza_name="Test Mouza",
            sheet_no="S-01",
            vertex_count=5,
            longest_side_m=85.3,
            shortest_side_m=42.1
        )
        db.session.add(parcel)
        db.session.flush()

        for i in range(5):
            v = ParcelVertex(
                parcel_id=parcel.id,
                x=100.0 + i * 10, y=200.0 + i * 10,
                lon=85.0 + i * 0.001, lat=25.0 + i * 0.001,
                sequence_order=i
            )
            db.session.add(v)

        report = LdmReport(
            parcel_id=parcel.id,
            report_url="/10/pdf/test.pdf",
            local_filename="reports/10_test_789.pdf"
        )
        db.session.add(report)
        db.session.commit()

        pid = parcel.id

        fetched = db.session.get(Parcel, pid)
        assert fetched.khata_no == "KH-001"
        assert fetched.pniu == "12345678901234"
        assert len(fetched.vertices) == 5
        assert fetched.report is not None
        assert fetched.report.local_filename == "reports/10_test_789.pdf"

        assert fetched.vertices[0].sequence_order == 0
        assert fetched.vertices[4].sequence_order == 4

        db.session.delete(fetched)
        db.session.commit()

        assert db.session.get(Parcel, pid) is None
        assert db.session.query(ParcelVertex).filter_by(parcel_id=pid).count() == 0
        assert db.session.query(LdmReport).filter_by(parcel_id=pid).count() == 0


# ── Test 4: Unique constraint (giscode, plot_no) ──

def test_unique_constraint(app):
    from models import db, Parcel

    with app.app_context():
        p1 = Parcel(giscode="10_x", plot_no="101")
        db.session.add(p1)
        db.session.commit()

        p2 = Parcel(giscode="10_x", plot_no="101")
        db.session.add(p2)
        with pytest.raises(Exception):
            db.session.commit()

        db.session.rollback()

        p3 = Parcel(giscode="10_y", plot_no="101")
        db.session.add(p3)
        db.session.commit()

        db.session.delete(p1)
        db.session.delete(p3)
        db.session.commit()


# ── Test 5: compute_segments helper ──

def test_compute_segments():
    from app import compute_segments

    vertices = [
        {"x": 0, "y": 0},
        {"x": 10, "y": 0},
        {"x": 10, "y": 10},
        {"x": 0, "y": 10},
    ]

    segs = compute_segments(vertices)

    assert len(segs) == 4
    assert segs[0]['start'] == 0 and segs[0]['end'] == 1
    assert abs(segs[0]['length_m'] - 10.0) < 0.01
    assert segs[1]['start'] == 1 and segs[1]['end'] == 2
    assert segs[2]['start'] == 2 and segs[2]['end'] == 3
    assert segs[3]['start'] == 3 and segs[3]['end'] == 0


# ── Test 6: parcel_to_dict helper ──

def test_parcel_to_dict(app):
    from models import db, Parcel, ParcelVertex
    from app import parcel_to_dict

    with app.app_context():
        parcel = Parcel(
            giscode="10_test_dict",
            plot_no="100",
            khata_no="KH-TEST",
            pniu="99999999999999",
            area_acres=2.0,
            area_hectares=0.809,
            area_sqm=8093.0,
            perimeter_m=400.0,
            lat=25.6, lon=85.2,
            owner_names='["Test Owner"]',
            district_name="Gaya",
            mouza_name="Test Village",
            vertex_count=4,
            longest_side_m=100.0,
            shortest_side_m=50.0
        )
        db.session.add(parcel)
        db.session.flush()

        for i in range(4):
            db.session.add(ParcelVertex(
                parcel_id=parcel.id,
                x=float(i * 10), y=float(i * 10),
                lon=85.0 + i * 0.001, lat=25.0 + i * 0.001,
                sequence_order=i
            ))
        db.session.commit()

        result = parcel_to_dict(parcel)
        assert 'parcel' in result
        assert 'vertices' in result
        assert 'segments' in result

        p = result['parcel']
        assert p['plot_no'] == "100"
        assert p['giscode'] == "10_test_dict"
        assert p['owner_names'] == ["Test Owner"]
        assert p['district'] == "Gaya"
        assert len(result['vertices']) == 4
        assert len(result['segments']) == 4

        db.session.delete(parcel)
        db.session.commit()


# ── Test 7: Home route ──

def test_home_page(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"Bihar Cadastral" in resp.data or b"Bhu-Overlay" in resp.data


# ── Test 8: Export routes return 404 for missing parcels ──

def test_export_missing(client):
    assert client.get("/proxy/Export/GeoJSON/nonexist/999").status_code == 404
    assert client.get("/proxy/Export/CSV/nonexist/999").status_code == 404
    assert client.get("/proxy/Reports/nonexist/999").status_code == 404


# ── Test 9: Plot details route validates inputs ──

def test_plot_details_validation(client):
    resp = client.post("/proxy/MapInfo/getPlotDetailsAndInspection", data={"state": "10"})
    assert resp.status_code == 400

    resp = client.post("/proxy/MapInfo/getPlotDetailsAndInspection",
                       data={"state": "10", "giscode": "abc"})
    assert resp.status_code == 400


# ── Test 10: WKT parsing ──

def test_wkt_parsing():
    from shapely import wkt

    geom = wkt.loads("POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))")
    assert geom.geom_type == 'Polygon'
    assert abs(geom.area - 100.0) < 0.01
    assert abs(geom.length - 40.0) < 0.01


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
