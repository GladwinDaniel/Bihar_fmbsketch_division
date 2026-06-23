let map;
let plotLyr;
let selPlotLyr;
let parcelVectorLayer;
let vectorSource;
let currentGisCode = "";
let currentLevels = "";
let currentExtent = null;
let currentParcelData = null;
let currentAdminNames = { district: "", subdivision: "", circle: "", mouza: "", sheet: "" };
const stateCode = "10";

let offsetX = 0.0;
let offsetY = 0.0;
const metersPerDegreeLat = 110800.0;
const metersPerDegreeLon = 100890.0;

$(document).ready(function () {
    initMap();
    initDropdowns();
    setupEventListeners();
    setupParcelEventListeners();
});

function initMap() {
    const googleSatelliteLayer = new ol.layer.Tile({
        title: "Google Satellite",
        type: "base",
        visible: true,
        source: new ol.source.XYZ({
            url: "https://mt{0-3}.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}&s=Ga",
            attributions: "\u00a9 Google Maps Satellite Overlay"
        })
    });

    plotLyr = new ol.layer.Image({
        title: "Cadastral Map",
        visible: false,
        opacity: 0.6,
        source: new ol.source.ImageWMS({
            url: "/proxy/WMS",
            params: {
                "LAYERS": "VILLAGE_MAP",
                "transparent": "TRUE",
                "state": stateCode,
                "SRS": "EPSG:4326",
                "VERSION": "1.1.1",
                "gis_code": ""
            },
            serverType: "geoserver"
        })
    });

    selPlotLyr = new ol.layer.Image({
        title: "Selected Plot",
        visible: false,
        opacity: 0.8,
        source: new ol.source.ImageWMS({
            url: "/proxy/WMS",
            params: {
                "LAYERS": "PLOT_LIST",
                "transparent": "TRUE",
                "state": stateCode,
                "SRS": "EPSG:4326",
                "VERSION": "1.1.1",
                "gis_code": "",
                "plot_id": "",
                "STYLES": "PLOT_SELECTION"
            },
            serverType: "geoserver"
        })
    });

    vectorSource = new ol.source.Vector();
    parcelVectorLayer = new ol.layer.Vector({
        title: "Parcel Boundary",
        visible: true,
        source: vectorSource,
        style: vectorStyleFunction
    });

    const applyBboxOffset = function (image, src) {
        if (offsetX !== 0 || offsetY !== 0) {
            try {
                const url = new URL(src, window.location.href || "http://localhost");
                const bbox = url.searchParams.get("BBOX");
                if (bbox) {
                    const coords = bbox.split(",").map(Number);
                    coords[0] -= offsetX;
                    coords[1] -= offsetY;
                    coords[2] -= offsetX;
                    coords[3] -= offsetY;
                    url.searchParams.set("BBOX", coords.join(","));
                    src = url.toString();
                }
            } catch (e) {
                console.error("Error shifting WMS BBOX:", e);
            }
        }
        image.getImage().src = src;
    };

    plotLyr.getSource().setImageLoadFunction(applyBboxOffset);
    selPlotLyr.getSource().setImageLoadFunction(applyBboxOffset);

    map = new ol.Map({
        target: "map",
        layers: [googleSatelliteLayer, plotLyr, selPlotLyr, parcelVectorLayer],
        view: new ol.View({
            projection: "EPSG:4326",
            center: [85.1376, 25.5941],
            zoom: 7
        })
    });
}

function vectorStyleFunction(feature) {
    const geomType = feature.getGeometry().getType();
    if (geomType === "Polygon") {
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: "rgba(255,105,180,0.15)" }),
            stroke: new ol.style.Stroke({ color: "#ff1493", width: 3 })
        });
    } else if (geomType === "Point") {
        const label = feature.get("label");
        if (label) {
            return new ol.style.Style({
                text: new ol.style.Text({
                    text: label,
                    font: "bold 12px Outfit, sans-serif",
                    fill: new ol.style.Fill({ color: "#ffffff" }),
                    stroke: new ol.style.Stroke({ color: "rgba(0,0,0,0.7)", width: 3 }),
                    offsetY: -14
                })
            });
        }
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 5,
                fill: new ol.style.Fill({ color: "#ffffff" }),
                stroke: new ol.style.Stroke({ color: "#ff1493", width: 2 })
            })
        });
    }
    return new ol.style.Style();
}

function redrawSelectedVector(parcelData) {
    currentParcelData = parcelData;
    vectorSource.clear();

    if (!parcelData || !parcelData.vertices || parcelData.vertices.length < 3) return;

    const vertices = parcelData.vertices;
    const segments = parcelData.segments || [];

    const ring = vertices.map(function (v) {
        return [v.lon + offsetX, v.lat + offsetY];
    });
    ring.push(ring[0]);

    const polygonFeature = new ol.Feature({
        geometry: new ol.geom.Polygon([ring])
    });
    vectorSource.addFeature(polygonFeature);

    vertices.forEach(function (v) {
        const pt = new ol.Feature({
            geometry: new ol.geom.Point([v.lon + offsetX, v.lat + offsetY])
        });
        vectorSource.addFeature(pt);
    });

    segments.forEach(function (s) {
        if (s.start < vertices.length && s.end < vertices.length) {
            const vStart = vertices[s.start];
            const vEnd = vertices[s.end];
            const midLon = (vStart.lon + vEnd.lon) / 2 + offsetX;
            const midLat = (vStart.lat + vEnd.lat) / 2 + offsetY;
            const label = new ol.Feature({
                geometry: new ol.geom.Point([midLon, midLat]),
                label: s.length_m.toFixed(1) + "m"
            });
            vectorSource.addFeature(label);
        }
    });
}

function updateOffsetReadout() {
    const xMeters = (offsetX * metersPerDegreeLon).toFixed(1);
    const yMeters = (offsetY * metersPerDegreeLat).toFixed(1);
    $("#offset-x-meters").text(xMeters + "m");
    $("#offset-y-meters").text(yMeters + "m");

    plotLyr.getSource().changed();
    selPlotLyr.getSource().changed();

    if (currentParcelData) {
        redrawSelectedVector(currentParcelData);
    }
}

function initDropdowns() {
    fetchDropdown(0, "");
}

function fetchDropdown(level, parentCodes) {
    showLoading(true, "Loading administrative levels...");

    $.post("/proxy/Levels/ListsAfterLevel", {
        state: stateCode,
        level: level,
        codes: parentCodes,
        hasmap: "true"
    }, function (data) {
        showLoading(false);
        if (!data || data.length === 0) return;

        const options = data[0];
        const targetSelectId = getSelectIdForLevel(level + 1);
        const $select = $("#" + targetSelectId);

        $select.empty().append('<option value="">--Select ' + getLevelLabel(level + 1) + '--</option>');

        options.forEach(function (item) {
            $select.append($("<option></option>").attr("value", item.code).text(item.value));
        });

        $select.prop("disabled", false);
    }, "json").fail(function () {
        showLoading(false);
        showToast("Error loading level options", "error");
    });
}

function setupEventListeners() {
    $("#opacity-slider").on("input", function () {
        const val = $(this).val();
        $("#opacity-value").text(val + "%");
        if (plotLyr) {
            plotLyr.setOpacity(val / 100);
        }
    });

    $("#sidebar-toggle-collapse").click(function () {
        $("#sidebar").addClass("collapsed");
        $("#sidebar-toggle-float").show();
    });

    $("#sidebar-toggle-float").click(function () {
        $("#sidebar").removeClass("collapsed");
        $(this).hide();
    });

    $("#select-district").change(function () {
        resetDropdownsFrom(2);
        const val = $(this).val();
        if (val) fetchDropdown(1, val + ",");
    });

    $("#select-subdiv").change(function () {
        resetDropdownsFrom(3);
        const val = $(this).val();
        const dist = $("#select-district").val();
        if (val) fetchDropdown(2, dist + "," + val + ",");
    });

    $("#select-circle").change(function () {
        resetDropdownsFrom(4);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        if (val) fetchDropdown(3, dist + "," + subdiv + "," + val + ",");
    });

    $("#select-mouza").change(function () {
        resetDropdownsFrom(5);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        const circle = $("#select-circle").val();
        if (val) fetchDropdown(4, dist + "," + subdiv + "," + circle + "," + val + ",");
    });

    $("#select-survey").change(function () {
        resetDropdownsFrom(6);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        const circle = $("#select-circle").val();
        const mouza = $("#select-mouza").val();
        if (val) fetchDropdown(5, dist + "," + subdiv + "," + circle + "," + mouza + "," + val + ",");
    });

    $("#select-mapinst").change(function () {
        resetDropdownsFrom(7);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        const circle = $("#select-circle").val();
        const mouza = $("#select-mouza").val();
        const survey = $("#select-survey").val();
        if (val) fetchDropdown(6, dist + "," + subdiv + "," + circle + "," + mouza + "," + survey + "," + val + ",");
    });

    $("#select-sheet").change(function () {
        const val = $(this).val();
        if (val) {
            currentAdminNames.district = $("#select-district option:selected").text();
            currentAdminNames.subdivision = $("#select-subdiv option:selected").text();
            currentAdminNames.circle = $("#select-circle option:selected").text();
            currentAdminNames.mouza = $("#select-mouza option:selected").text();
            currentAdminNames.sheet = $("#select-sheet option:selected").text();
            loadVillageSheet();
        }
    });

    const stepDeg = 0.00001;

    $("#btn-nudge-up").click(function () {
        offsetY += stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-down").click(function () {
        offsetY -= stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-left").click(function () {
        offsetX -= stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-right").click(function () {
        offsetX += stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-reset").click(function () {
        offsetX = 0.0;
        offsetY = 0.0;
        updateOffsetReadout();
    });

    map.on("singleclick", function (evt) {
        if (!currentGisCode) {
            showToast("Please select a location sheet first", "warning");
            return;
        }

        const coords = evt.coordinate;
        const lon = coords[0] - offsetX;
        const lat = coords[1] - offsetY;

        showLoading(true, "Querying clicked parcel...");

        $.post("/proxy/MapInfo/getPlotAtGPS", {
            state: stateCode,
            giscode: currentGisCode,
            levels: currentLevels,
            lon: lon,
            lat: lat
        }, function (data) {
            if (data && data.id) {
                selPlotLyr.getSource().updateParams({
                    "gis_code": currentGisCode,
                    "plot_id": data.id
                });
                selPlotLyr.setVisible(true);

                const plotNo = data.kide || "";
                const plotId = data.id || "";
                fetchParcelDetails(plotNo, plotId, lon, lat);
            } else {
                showLoading(false);
                showToast("No parcel found at clicked coordinates", "warning");
            }
        }, "json").fail(function () {
            showLoading(false);
            showToast("Failed to query clicked coordinates", "error");
        });
    });

    $("#btn-search-pniu").click(executePniuSearch);
    $("#search-pniu").keypress(function (e) {
        if (e.which === 13) executePniuSearch();
    });

    $("#btn-download-map").click(function () {
        if (!currentGisCode || !currentExtent) {
            showToast("Please select a map sheet to scrape", "warning");
            return;
        }

        const bboxStr = currentExtent.xmin + "," + currentExtent.ymin + "," + currentExtent.xmax + "," + currentExtent.ymax;
        const downloadUrl = "/proxy/WMS?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=VILLAGE_MAP&transparent=true&state=" + stateCode + "&SRS=EPSG:4326&gis_code=" + currentGisCode + "&BBOX=" + bboxStr + "&WIDTH=2048&HEIGHT=1536&FORMAT=image/png";

        window.open(downloadUrl, "_blank");
        showToast("Scraping high-resolution WMS image...", "success");
    });
}

function setupParcelEventListeners() {
    $("#btn-view-report").click(function () {
        if (!currentParcelData || !currentParcelData.report) return;
        const giscode = currentParcelData.parcel.giscode;
        const plotNo = currentParcelData.parcel.plot_no;
        const pdfUrl = "/proxy/Reports/" + giscode + "/" + plotNo;
        $("#pdf-viewer").attr("src", pdfUrl);
        $("#pdf-modal").fadeIn(200);
    });

    $("#btn-modal-close").click(function () {
        $("#pdf-modal").fadeOut(200);
        setTimeout(function () {
            $("#pdf-viewer").attr("src", "");
        }, 300);
    });

    $(document).click(function (e) {
        if ($(e.target).is("#pdf-modal")) {
            $("#pdf-modal").fadeOut(200);
            setTimeout(function () {
                $("#pdf-viewer").attr("src", "");
            }, 300);
        }
    });

    $(document).keydown(function (e) {
        if (e.key === "Escape" && $("#pdf-modal").is(":visible")) {
            $("#pdf-modal").fadeOut(200);
            setTimeout(function () {
                $("#pdf-viewer").attr("src", "");
            }, 300);
        }
    });

    $("#btn-download-report").click(function () {
        if (!currentParcelData || !currentParcelData.report) return;
        const giscode = currentParcelData.parcel.giscode;
        const plotNo = currentParcelData.parcel.plot_no;
        window.open("/proxy/Reports/" + giscode + "/" + plotNo, "_blank");
    });

    $("#btn-export-geojson").click(function () {
        if (!currentParcelData) return;
        const giscode = currentParcelData.parcel.giscode;
        const plotNo = currentParcelData.parcel.plot_no;
        window.location.href = "/proxy/Export/GeoJSON/" + giscode + "/" + plotNo;
    });

    $("#btn-export-csv").click(function () {
        if (!currentParcelData) return;
        const giscode = currentParcelData.parcel.giscode;
        const plotNo = currentParcelData.parcel.plot_no;
        window.location.href = "/proxy/Export/CSV/" + giscode + "/" + plotNo;
    });
}

function fetchParcelDetails(plotNo, plotId, clickLon, clickLat) {
    if (!plotNo || !currentGisCode) {
        showLoading(false);
        return;
    }

    var postData = {
        state: stateCode,
        giscode: currentGisCode,
        plot_no: plotNo,
        plot_id: plotId || "",
        levels: currentLevels,
        district_name: currentAdminNames.district,
        subdivision_name: currentAdminNames.subdivision,
        circle_name: currentAdminNames.circle,
        mouza_name: currentAdminNames.mouza,
        sheet_no: currentAdminNames.sheet
    };
    if (clickLon != null) postData.click_lon = clickLon;
    if (clickLat != null) postData.click_lat = clickLat;

    $.ajax({
        url: "/proxy/MapInfo/getPlotDetailsAndInspection",
        method: "POST",
        data: postData,
        dataType: "json",
        timeout: 30000,
        success: function (data) {
            showLoading(false);
            if (!data || !data.parcel) {
                showToast("Failed to load parcel details", "error");
                return;
            }
            populateParcelPanels(data);
            if (data.vertices && data.vertices.length > 0) {
                redrawSelectedVector(data);
            }
            showToast("Plot " + plotNo + " details loaded", "success");
        },
        error: function () {
            showLoading(false);
            showToast("Failed to fetch parcel details", "error");
        }
    });
}

function populateParcelPanels(data) {
    const p = data.parcel;

    $("#val-district").text(p.district || "--");
    $("#val-circle").text(p.circle || "--");
    $("#val-mouza").text(p.mouza || "--");
    $("#val-sheet-no").text(p.sheet_no || "--");
    $("#val-plot-no").text(p.plot_no || "--");
    $("#val-khata").text(p.khata_no || "--");
    $("#val-pniu").text(p.pniu || "--");

    if (p.owner_names && p.owner_names.length > 0) {
        $("#val-owners").text(p.owner_names.join("\n"));
    } else {
        $("#val-owners").text("--");
    }

    if (p.area_sqm != null && p.area_sqm > 0) {
        $("#val-area-acres").text(p.area_acres.toFixed(4) + " acres");
        $("#val-area-ha").text(p.area_hectares.toFixed(4) + " ha");
        $("#val-area-sqm").text(p.area_sqm.toFixed(2) + " sq.m");
    } else {
        $("#val-area-acres").text("--");
        $("#val-area-ha").text("");
        $("#val-area-sqm").text("");
    }

    $("#val-perimeter").text(p.perimeter_m != null && p.perimeter_m > 0 ? p.perimeter_m.toFixed(2) + " m" : "--");
    $("#val-longest-side").text(p.longest_side_m != null && p.longest_side_m > 0 ? p.longest_side_m.toFixed(2) + " m" : "--");
    $("#val-shortest-side").text(p.shortest_side_m != null && p.shortest_side_m > 0 ? p.shortest_side_m.toFixed(2) + " m" : "--");
    $("#val-vertex-count").text(p.vertex_count != null && p.vertex_count > 0 ? p.vertex_count : "--");

    $("#panel-parcel-details").show();

    if (p.area_sqm != null && p.area_sqm > 0) {
        $("#panel-measurements").show();
    } else {
        $("#panel-measurements").hide();
    }

    var hasGeometry = data.vertices && data.vertices.length > 0;
    $("#btn-view-report").prop("disabled", true);
    $("#btn-download-report").prop("disabled", true);
    $("#btn-export-geojson").prop("disabled", !hasGeometry);
    $("#btn-export-csv").prop("disabled", !hasGeometry);

    if (hasGeometry) {
        $("#panel-documents").show();
    } else {
        $("#panel-documents").hide();
    }
}

function clearParcelPanels() {
    $("#panel-parcel-details").hide();
    $("#panel-measurements").hide();
    $("#panel-documents").hide();
    currentParcelData = null;
    vectorSource.clear();
}

function loadVillageSheet() {
    const dist = $("#select-district").val();
    const subdiv = $("#select-subdiv").val();
    const circle = $("#select-circle").val();
    const mouza = $("#select-mouza").val();
    const survey = $("#select-survey").val();
    const mapinst = $("#select-mapinst").val();
    const sheet = $("#select-sheet").val();

    currentLevels = dist + "," + subdiv + "," + circle + "," + mouza + "," + survey + "," + mapinst + "," + sheet + ",";

    showLoading(true, "Fetching georeferenced sheet boundaries...");

    $.post("/proxy/MapInfo/getVVVVExtentGeoref", {
        state: stateCode,
        gisLevels: currentLevels,
        srs: "4326"
    }, function (data) {
        showLoading(false);
        if (!data || !data.gisCode) {
            showToast("Failed to load sheet metadata", "error");
            return;
        }

        currentGisCode = data.gisCode;

        const isAnomaly = (data.xmax > 180 && data.xmin < 180) || (data.xmin === 0 && data.ymin === 0);

        if (isAnomaly) {
            currentExtent = {
                xmin: 84.0,
                ymin: 24.5,
                xmax: 88.0,
                ymax: 27.5
            };
            showToast("Database boundary anomaly detected for Sheet 00. Centering on Bihar.", "warning");
            map.getView().setCenter([85.1376, 25.5941]);
            map.getView().setZoom(7);
        } else {
            currentExtent = {
                xmin: data.xmin,
                ymin: data.ymin,
                xmax: data.xmax,
                ymax: data.ymax
            };
            map.getView().fit([data.xmin, data.ymin, data.xmax, data.ymax], {
                size: map.getSize(),
                duration: 1000
            });
        }

        plotLyr.getSource().updateParams({
            "gis_code": currentGisCode
        });
        plotLyr.setVisible(true);

        selPlotLyr.setVisible(false);
        clearParcelPanels();

        showToast("Cadastral map overlaid successfully", "success");
    }, "json").fail(function () {
        showLoading(false);
        showToast("Error retrieving map boundaries", "error");
    });
}

function executePniuSearch() {
    const pniu = $("#search-pniu").val().trim();
    if (!pniu) {
        showToast("Please enter a PNIU code", "warning");
        return;
    }
    if (!currentGisCode) {
        showToast("Please select the village sheet first", "warning");
        return;
    }

    showLoading(true, "Resolving PNIU code: " + pniu + "...");

    $.post("/proxy/MapInfo/getPointsfromPNIU", {
        state: stateCode,
        pniu: pniu,
        gisCode: currentGisCode
    }, function (data) {
        showLoading(false);
        if (!data || data.includes("null") || data.split(",").length < 10) {
            showToast("PNIU code not found in this village sheet", "error");
            return;
        }

        const parts = data.split(",");
        const plotId = parts[4];
        const plotNo = parts[5];
        const centerLon = parseFloat(parts[2]);
        const centerLat = parseFloat(parts[3]);

        const xmin = parseFloat(parts[6]);
        const ymin = parseFloat(parts[7]);
        const xmax = parseFloat(parts[8]);
        const ymax = parseFloat(parts[9]);

        selPlotLyr.getSource().updateParams({
            "gis_code": currentGisCode,
            "plot_id": plotId
        });
        selPlotLyr.setVisible(true);

        map.getView().fit([xmin + offsetX, ymin + offsetY, xmax + offsetX, ymax + offsetY], {
            size: map.getSize(),
            duration: 1000
        });

        fetchParcelDetails(plotNo, plotId, centerLon, centerLat);
    }, "text").fail(function () {
        showLoading(false);
        showToast("Failed to search PNIU code", "error");
    });
}

function resetDropdownsFrom(levelNumber) {
    for (let l = levelNumber; l <= 7; l++) {
        const selectId = getSelectIdForLevel(l);
        const $select = $("#" + selectId);
        $select.empty().append('<option value="">--Select ' + getLevelLabel(l) + '--</option>');
        $select.prop("disabled", true);
    }
}

function getSelectIdForLevel(level) {
    const ids = {
        1: "select-district",
        2: "select-subdiv",
        3: "select-circle",
        4: "select-mouza",
        5: "select-survey",
        6: "select-mapinst",
        7: "select-sheet"
    };
    return ids[level];
}

function getLevelLabel(level) {
    const labels = {
        1: "District",
        2: "Subdivision",
        3: "Circle",
        4: "Mouza",
        5: "Survey Type",
        6: "Map Instance",
        7: "Sheet"
    };
    return labels[level];
}

function showLoading(show, text) {
    if (text === undefined) text = "Loading...";
    const $loader = $("#loading");
    $("#loading-text").text(text);
    if (show) {
        $loader.addClass("active");
    } else {
        $loader.removeClass("active");
    }
}

let toastTimeout;
function showToast(message, type) {
    if (type === undefined) type = "info";
    clearTimeout(toastTimeout);
    const $toast = $("#toast");
    const $icon = $("#toast-icon");
    $("#toast-message").text(message);

    $icon.removeClass("warning error success info");

    if (type === "warning") $icon.addClass("fa-exclamation-triangle warning");
    else if (type === "error") $icon.addClass("fa-times-circle error");
    else if (type === "success") $icon.addClass("fa-check-circle success");
    else $icon.addClass("fa-info-circle info");

    $toast.addClass("active");

    toastTimeout = setTimeout(function () {
        $toast.removeClass("active");
    }, 4000);
}
