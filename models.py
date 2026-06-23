from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone

db = SQLAlchemy()


class Parcel(db.Model):
    __tablename__ = 'parcels'

    id = db.Column(db.Integer, primary_key=True)
    giscode = db.Column(db.String(50), nullable=False)
    plot_id = db.Column(db.String(50))
    plot_no = db.Column(db.String(50), nullable=False)
    khata_no = db.Column(db.String(100))
    pniu = db.Column(db.String(50))
    area_acres = db.Column(db.Float)
    area_hectares = db.Column(db.Float)
    area_sqm = db.Column(db.Float)
    perimeter_m = db.Column(db.Float)
    lat = db.Column(db.Float)
    lon = db.Column(db.Float)
    owner_names = db.Column(db.Text)
    district_name = db.Column(db.String(100))
    subdivision_name = db.Column(db.String(100))
    circle_name = db.Column(db.String(100))
    mouza_name = db.Column(db.String(100))
    sheet_no = db.Column(db.String(50))
    vertex_count = db.Column(db.Integer)
    longest_side_m = db.Column(db.Float)
    shortest_side_m = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                           onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('giscode', 'plot_no', name='uq_parcel_giscode_plotno'),
    )

    vertices = db.relationship('ParcelVertex', backref='parcel', lazy='joined',
                               cascade='all, delete-orphan',
                               order_by='ParcelVertex.sequence_order')
    report = db.relationship('LdmReport', backref='parcel', lazy='joined',
                             uselist=False, cascade='all, delete-orphan')


class ParcelVertex(db.Model):
    __tablename__ = 'parcel_vertices'

    id = db.Column(db.Integer, primary_key=True)
    parcel_id = db.Column(db.Integer, db.ForeignKey('parcels.id'), nullable=False)
    x = db.Column(db.Float)
    y = db.Column(db.Float)
    lon = db.Column(db.Float)
    lat = db.Column(db.Float)
    sequence_order = db.Column(db.Integer, nullable=False)


class LdmReport(db.Model):
    __tablename__ = 'ldm_reports'

    id = db.Column(db.Integer, primary_key=True)
    parcel_id = db.Column(db.Integer, db.ForeignKey('parcels.id'), nullable=False, unique=True)
    report_url = db.Column(db.String(500))
    local_filename = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
