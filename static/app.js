// Bihar Cadastral Map & Satellite Dashboard GIS Logic

let map;
let plotLyr;
let selPlotLyr;
let vectorSource;
let vectorLayer;
let currentParcelData = null;
let currentGisCode = "";
let currentLevels = "";
let currentExtent = null;
const stateCode = "10"; // Bihar State Code

// Alignment offsets (visual nudge) in degrees
let offsetX = 0.0;
let offsetY = 0.0;
const metersPerDegreeLat = 110800.0;
const metersPerDegreeLon = 100890.0;

$(document).ready(function() {
    initMap();
    initDropdowns();
    setupEventListeners();
});

const vectorStyleFunction = function(feature) {
    const styles = [];
    const geom = feature.getGeometry();
    if (!geom) return styles;
    
    // 1. Polygon Outline & Fill
    styles.push(new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#ff3366',
            width: 3
        }),
        fill: new ol.style.Fill({
            color: 'rgba(255, 51, 102, 0.15)'
        })
    }));
    
    const coordinates = geom.getCoordinates()[0];
    if (coordinates) {
        // 2. Vertex markers (small circles at points)
        coordinates.forEach((coord, index) => {
            if (index === coordinates.length - 1) return; // skip closing coord
            styles.push(new ol.style.Style({
                geometry: new ol.geom.Point(coord),
                image: new ol.style.Circle({
                    radius: 5,
                    fill: new ol.style.Fill({
                        color: '#ffffff'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#ff3366',
                        width: 2
                    })
                })
            }));
        });
        
        // 3. Side length labels (midpoints)
        const segmentLengths = feature.get('segment_lengths');
        if (segmentLengths) {
            for (let i = 0; i < coordinates.length - 1; i++) {
                const p1 = coordinates[i];
                const p2 = coordinates[i+1];
                
                const midX = (p1[0] + p2[0]) / 2;
                const midY = (p1[1] + p2[1]) / 2;
                
                const lenVal = segmentLengths[i];
                const labelText = lenVal ? `${lenVal.toFixed(1)}m` : '';
                
                styles.push(new ol.style.Style({
                    geometry: new ol.geom.Point([midX, midY]),
                    text: new ol.style.Text({
                        text: labelText,
                        font: 'bold 11px Outfit, sans-serif',
                        fill: new ol.style.Fill({ color: '#ffffff' }),
                        stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                        offsetY: -8,
                        placement: 'point'
                    })
                }));
            }
        }
    }
    return styles;
};

// 1. Initialize Map
function initMap() {
    // Google Satellite Imagery layer
    const googleSatelliteLayer = new ol.layer.Tile({
        title: "Google Satellite",
        type: "base",
        visible: true,
        source: new ol.source.XYZ({
            url: "https://mt{0-3}.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}&s=Ga",
            attributions: "© Google Maps Satellite Overlay"
        })
    });

    // BhuNaksha WMS Village Map layer (transparent overlay)
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

    // BhuNaksha WMS Selected Plot Highlight layer
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

    // Custom WMS image load function to apply alignment offsets (visual nudge)
    const applyBboxOffset = function(image, src) {
        if (offsetX !== 0 || offsetY !== 0) {
            try {
                const url = new URL(src, window.location.href || "http://localhost");
                const bbox = url.searchParams.get("BBOX");
                if (bbox) {
                    const coords = bbox.split(",").map(Number);
                    // Subtract offset to request shifted viewport relative to OL coordinates,
                    // which visualizes as shifting the drawn elements by +offsetX/+offsetY.
                    coords[0] -= offsetX;
                    coords[1] -= offsetY;
                    coords[2] -= offsetX;
                    coords[3] -= offsetY;
                    url.searchParams.set("BBOX", coords.join(","));
                    src = url.toString();
                }
            } catch(e) {
                console.error("Error shifting WMS BBOX:", e);
            }
        }
        image.getImage().src = src;
    };

    plotLyr.getSource().setImageLoadFunction(applyBboxOffset);
    selPlotLyr.getSource().setImageLoadFunction(applyBboxOffset);

    vectorSource = new ol.source.Vector();
    vectorLayer = new ol.layer.Vector({
        source: vectorSource,
        style: vectorStyleFunction
    });

    // Setup map view centered on Patna, Bihar
    map = new ol.Map({
        target: "map",
        layers: [googleSatelliteLayer, plotLyr, selPlotLyr, vectorLayer],
        view: new ol.View({
            projection: "EPSG:4326",
            center: [85.1376, 25.5941], // Patna GPS Coordinates
            zoom: 7
        })
    });
}

// 2. Initialize Dropdowns (Trigger first level - Districts)
function initDropdowns() {
    fetchDropdown(0, ""); // Fetch Level 0 -> District List
}

// 3. Dropdown Fetching Logic
function fetchDropdown(level, parentCodes) {
    showLoading(true, `Loading administrative levels...`);
    
    $.post("/proxy/Levels/ListsAfterLevel", {
        state: stateCode,
        level: level,
        codes: parentCodes,
        hasmap: "true"
    }, function(data) {
        showLoading(false);
        if (!data || data.length === 0) return;

        // The dropdown data is returned at index 0 of the response list
        const options = data[0];
        const targetSelectId = getSelectIdForLevel(level + 1);
        const $select = $(`#${targetSelectId}`);
        
        $select.empty().append(`<option value="">--Select ${getLevelLabel(level + 1)}--</option>`);
        
        options.forEach(item => {
            $select.append($("<option></option>").attr("value", item.code).text(item.value));
        });

        $select.prop("disabled", false);
    }, "json").fail(function(xhr, status, error) {
        showLoading(false);
        showToast("Error loading level options", "error");
    });
}

// 4. Setup Event Listeners
function setupEventListeners() {
    // Opacity Slider
    $("#opacity-slider").on("input", function() {
        const val = $(this).val();
        $("#opacity-value").text(`${val}%`);
        if (plotLyr) {
            plotLyr.setOpacity(val / 100);
        }
    });

    // Sidebar Toggles
    $("#sidebar-toggle-collapse").click(function() {
        $("#sidebar").addClass("collapsed");
        $("#sidebar-toggle-float").show();
    });

    $("#sidebar-toggle-float").click(function() {
        $("#sidebar").removeClass("collapsed");
        $(this).hide();
    });

    // Dropdown Cascade Triggers
    $("#select-district").change(function() {
        resetDropdownsFrom(2);
        const val = $(this).val();
        if (val) fetchDropdown(1, `${val},`);
    });

    $("#select-subdiv").change(function() {
        resetDropdownsFrom(3);
        const val = $(this).val();
        const dist = $("#select-district").val();
        if (val) fetchDropdown(2, `${dist},${val},`);
    });

    $("#select-circle").change(function() {
        resetDropdownsFrom(4);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        if (val) fetchDropdown(3, `${dist},${subdiv},${val},`);
    });

    $("#select-mouza").change(function() {
        resetDropdownsFrom(5);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        const circle = $("#select-circle").val();
        if (val) fetchDropdown(4, `${dist},${subdiv},${circle},${val},`);
    });

    $("#select-survey").change(function() {
        resetDropdownsFrom(6);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        const circle = $("#select-circle").val();
        const mouza = $("#select-mouza").val();
        if (val) fetchDropdown(5, `${dist},${subdiv},${circle},${mouza},${val},`);
    });

    $("#select-mapinst").change(function() {
        resetDropdownsFrom(7);
        const val = $(this).val();
        const dist = $("#select-district").val();
        const subdiv = $("#select-subdiv").val();
        const circle = $("#select-circle").val();
        const mouza = $("#select-mouza").val();
        const survey = $("#select-survey").val();
        if (val) fetchDropdown(6, `${dist},${subdiv},${circle},${mouza},${survey},${val},`);
    });

    // Final Sheet selection triggers loading map
    $("#select-sheet").change(function() {
        const val = $(this).val();
        if (val) {
            loadVillageSheet();
        }
    });

    // Setup Nudge Button event handlers
    const updateOffsetReadout = function() {
        const xMeters = (offsetX * metersPerDegreeLon).toFixed(1);
        const yMeters = (offsetY * metersPerDegreeLat).toFixed(1);
        $("#offset-x-meters").text(`${xMeters}m`);
        $("#offset-y-meters").text(`${yMeters}m`);
        
        // Force refresh WMS layer visual positions by marking source as changed
        plotLyr.getSource().changed();
        selPlotLyr.getSource().changed();
        
        // Redraw vector polygon with updated shift
        redrawSelectedVector();
    };

    const stepDeg = 0.00001; // roughly 1 meter shift per click

    $("#btn-nudge-up").click(function() {
        offsetY += stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-down").click(function() {
        offsetY -= stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-left").click(function() {
        offsetX -= stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-right").click(function() {
        offsetX += stepDeg;
        updateOffsetReadout();
    });

    $("#btn-nudge-reset").click(function() {
        offsetX = 0.0;
        offsetY = 0.0;
        updateOffsetReadout();
    });

    // PDF Modal view button
    $("#btn-view-ldm").click(function() {
        if (currentParcelData && currentParcelData.report && currentParcelData.report.url) {
            $("#pdf-iframe").attr("src", currentParcelData.report.url);
            $("#pdf-modal").addClass("active");
        }
    });

    // Close PDF modal
    $("#btn-close-pdf").click(function() {
        $("#pdf-modal").removeClass("active");
        $("#pdf-iframe").attr("src", "");
    });
    
    // Close modal on background click
    $("#pdf-modal").click(function(e) {
        if (e.target === this) {
            $(this).removeClass("active");
            $("#pdf-iframe").attr("src", "");
        }
    });

    // PDF Download button
    $("#btn-download-ldm").click(function() {
        if (currentParcelData && currentParcelData.report && currentParcelData.report.url) {
            window.open(currentParcelData.report.url, "_blank");
        }
    });

    // Export GeoJSON
    $("#btn-export-geojson").click(function() {
        if (currentParcelData && currentParcelData.parcel) {
            const url = `/proxy/Export/GeoJSON/${currentParcelData.parcel.plot_no}?parcel_id=${currentParcelData.parcel.id}`;
            window.open(url, "_blank");
        }
    });

    // Export CSV
    $("#btn-export-csv").click(function() {
        if (currentParcelData && currentParcelData.parcel) {
            const url = `/proxy/Export/CSV/${currentParcelData.parcel.plot_no}?parcel_id=${currentParcelData.parcel.id}`;
            window.open(url, "_blank");
        }
    });

    // Click on Map coordinates to select parcel
    map.on("singleclick", function(evt) {
        if (!currentGisCode) {
            showToast("Please select a location sheet first", "warning");
            return;
        }

        const coords = evt.coordinate; // [lon, lat]
        // Nudge coords: subtract offset to match shifted visual overlay back to base coordinate system
        const lon = coords[0] - offsetX;
        const lat = coords[1] - offsetY;

        showLoading(true, "Querying clicked parcel coordinates...");

        $.post("/proxy/MapInfo/getPlotAtGPS", {
            state: stateCode,
            giscode: currentGisCode,
            levels: currentLevels,
            lon: lon,
            lat: lat
        }, function(data) {
            showLoading(false);
            if (data && data.kide) {
                selectPlotByNumber(data.kide);
            } else {
                showToast("No parcel found at clicked coordinates", "warning");
            }
        }, "json").fail(function() {
            showLoading(false);
            showToast("Failed to query clicked coordinates", "error");
        });
    });

    // Search by PNIU Code
    $("#btn-search-pniu").click(executePniuSearch);
    $("#search-pniu").keypress(function(e) {
        if (e.which === 13) executePniuSearch();
    });

    // Scrape / Download Map Image
    $("#btn-download-map").click(function() {
        if (!currentGisCode || !currentExtent) {
            showToast("Please select a map sheet to scrape", "warning");
            return;
        }

        // Construct a direct WMS GetMap download link for the user
        const bboxStr = `${currentExtent.xmin},${currentExtent.ymin},${currentExtent.xmax},${currentExtent.ymax}`;
        const downloadUrl = `/proxy/WMS?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=VILLAGE_MAP&transparent=true&state=${stateCode}&SRS=EPSG:4326&gis_code=${currentGisCode}&BBOX=${bboxStr}&WIDTH=2048&HEIGHT=1536&FORMAT=image/png`;
        
        // Open download link in a new tab
        window.open(downloadUrl, "_blank");
        showToast("Scraping high-resolution WMS image...", "success");
    });
}

// 5. Load Village Sheet Extents & WMS
function loadVillageSheet() {
    const dist = $("#select-district").val();
    const subdiv = $("#select-subdiv").val();
    const circle = $("#select-circle").val();
    const mouza = $("#select-mouza").val();
    const survey = $("#select-survey").val();
    const mapinst = $("#select-mapinst").val();
    const sheet = $("#select-sheet").val();

    // Construct level string (comma terminated)
    currentLevels = `${dist},${subdiv},${circle},${mouza},${survey},${mapinst},${sheet},`;
    
    showLoading(true, "Fetching georeferenced sheet boundaries...");

    $.post("/proxy/MapInfo/getVVVVExtentGeoref", {
        state: stateCode,
        gisLevels: currentLevels,
        srs: "4326" // Directly request GPS coordinates
    }, function(data) {
        showLoading(false);
        if (!data || !data.gisCode) {
            showToast("Failed to load sheet metadata", "error");
            return;
        }

        currentGisCode = data.gisCode;

        // Check for Sheet "00" or Database anomalies
        // Mismatched check: degrees (xmin/ymin) vs meters (xmax/ymax)
        // If xmax > 180, it's UTM meters, indicating corrupted extent
        const isAnomaly = (data.xmax > 180 && data.xmin < 180) || (data.xmin === 0 && data.ymin === 0);

        if (isAnomaly) {
            currentExtent = {
                xmin: 84.0, // General Bihar bounds fallback
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
            // Fit map view to GPS bounds
            map.getView().fit([data.xmin, data.ymin, data.xmax, data.ymax], {
                size: map.getSize(),
                duration: 1000
            });
        }

        // Update WMS layer source parameters
        plotLyr.getSource().updateParams({
            "gis_code": currentGisCode
        });
        plotLyr.setVisible(true);

        // Reset selected plot layer
        selPlotLyr.setVisible(false);
        clearDetails();
        
        showToast("Cadastral map overlaid successfully", "success");
    }, "json").fail(function() {
        showLoading(false);
        showToast("Error retrieving map boundaries", "error");
    });
}

// 6. Execute PNIU Search
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

    showLoading(true, `Resolving PNIU code: ${pniu}...`);

    $.post("/proxy/MapInfo/getPointsfromPNIU", {
        state: stateCode,
        pniu: pniu,
        gisCode: currentGisCode
    }, function(data) {
        if (!data || data.includes("null") || data.split(",").length < 10) {
            showLoading(false);
            showToast("PNIU code not found in this village sheet", "error");
            return;
        }

        const parts = data.split(",");
        const plotNo = parts[5];
        
        // Query details and geometry for the resolved plot number
        selectPlotByNumber(plotNo);
    }, "text").fail(function() {
        showLoading(false);
        showToast("Failed to search PNIU code", "error");
    });
}

// Helper: Clear Details Sidebar
function clearDetails() {
    $("#val-plot-no").text("--");
    $("#val-khata-no").text("--");
    $("#val-pniu").text("--");
    $("#val-lat").text("--");
    $("#val-lon").text("--");
    $("#val-owners").text("--");
    
    $("#val-area-sqm").text("--");
    $("#val-area-acres").text("--");
    $("#val-area-hectares").text("--");
    $("#val-perimeter").text("--");
    $("#val-vertices-count").text("--");
    $("#val-longest-side").text("--");
    $("#val-shortest-side").text("--");
    $("#val-avg-side").text("--");
    
    $("#btn-view-ldm").prop("disabled", true);
    $("#btn-download-ldm").prop("disabled", true);
    $("#btn-export-geojson").prop("disabled", true);
    $("#btn-export-csv").prop("disabled", true);
    
    currentParcelData = null;
    if (vectorSource) {
        vectorSource.clear();
    }
}

// Fetch Full Plot Details and Geometry
function selectPlotByNumber(plotNo) {
    showLoading(true, `Loading details for plot ${plotNo}...`);
    
    $.post("/proxy/MapInfo/getPlotDetailsAndInspection", {
        state: stateCode,
        giscode: currentGisCode,
        plot_no: plotNo,
        levels: currentLevels
    }, function(res) {
        showLoading(false);
        if (res && res.success) {
            displayParcelDetails(res);
            zoomToParcel();
            showToast(`Plot ${plotNo} details loaded successfully`, "success");
        } else {
            showToast(res.error || "Failed to retrieve plot details", "error");
        }
    }, "json").fail(function(xhr) {
        showLoading(false);
        const err = xhr.responseJSON ? xhr.responseJSON.error : "Failed to query backend server";
        showToast(err, "error");
    });
}

// Render Parcel details and draw vector overlay
function displayParcelDetails(data) {
    currentParcelData = data;
    
    // Update Details
    $("#val-plot-no").text(data.parcel.plot_no || "--");
    $("#val-khata-no").text(data.parcel.khata_no || "--");
    $("#val-pniu").text(data.parcel.pniu || "--");
    $("#val-lat").text(data.parcel.lat != null ? data.parcel.lat.toFixed(6) : "--");
    $("#val-lon").text(data.parcel.lon != null ? data.parcel.lon.toFixed(6) : "--");
    
    const $owners = $("#val-owners");
    $owners.empty();
    if (data.parcel.owner_names && data.parcel.owner_names.length > 0) {
        data.parcel.owner_names.forEach((name, i) => {
            $owners.append(`<div>${i+1}. ${name}</div>`);
        });
    } else {
        $owners.text("--");
    }
    
    // Update Measurements
    const areaVal = data.parcel.area;
    $("#val-area-sqm").text(areaVal != null ? `${areaVal.toFixed(1)} m²` : "--");
    $("#val-area-acres").text(areaVal != null ? `${(areaVal / 4046.8564).toFixed(3)} acres` : "--");
    $("#val-area-hectares").text(areaVal != null ? `${(areaVal / 10000.0).toFixed(3)} ha` : "--");
    $("#val-perimeter").text(data.parcel.perimeter != null ? `${data.parcel.perimeter.toFixed(1)} m` : "--");
    $("#val-vertices-count").text(data.vertices.length || "--");
    
    if (data.segments && data.segments.length > 0) {
        const lengths = data.segments.map(s => s.length_meters);
        const maxLen = Math.max(...lengths);
        const minLen = Math.min(...lengths);
        const sumLen = lengths.reduce((a, b) => a + b, 0);
        const avgLen = sumLen / lengths.length;
        
        $("#val-longest-side").text(`${maxLen.toFixed(1)} m`);
        $("#val-shortest-side").text(`${minLen.toFixed(1)} m`);
        $("#val-avg-side").text(`${avgLen.toFixed(1)} m`);
    } else {
        $("#val-longest-side").text("--");
        $("#val-shortest-side").text("--");
        $("#val-avg-side").text("--");
    }
    
    // Enable Exports
    $("#btn-export-geojson").prop("disabled", false);
    $("#btn-export-csv").prop("disabled", false);
    
    // Enable PDF controls
    if (data.report && data.report.url) {
        $("#btn-view-ldm").prop("disabled", false);
        $("#btn-download-ldm").prop("disabled", false);
    } else {
        $("#btn-view-ldm").prop("disabled", true);
        $("#btn-download-ldm").prop("disabled", true);
    }
    
    // Draw vector polygon on map
    redrawSelectedVector();
    
    // Highlight WMS layer
    selPlotLyr.getSource().updateParams({
        "gis_code": currentGisCode,
        "plot_id": data.parcel.plot_id
    });
    selPlotLyr.setVisible(true);

    // Auto-scroll sidebar content to the Measurements section
    const $sidebarContent = $(".sidebar-content");
    const $measurementSection = $("#measurement-section");
    if ($sidebarContent.length && $measurementSection.length) {
        const sidebarOffset = $sidebarContent.offset();
        const measurementOffset = $measurementSection.offset();
        if (sidebarOffset && measurementOffset) {
            const scrollTopTarget = measurementOffset.top - sidebarOffset.top + $sidebarContent.scrollTop() - 10;
            $sidebarContent.animate({
                scrollTop: scrollTopTarget
            }, 600);
        }
    }

    // Trigger visual highlight animation
    const $measurementCard = $("#measurement-card");
    if ($measurementCard.length) {
        $measurementCard.addClass("section-highlight");
        setTimeout(() => {
            $measurementCard.removeClass("section-highlight");
        }, 2000);
    }
}


// Draw/Shift vector polygon boundary on map
function redrawSelectedVector() {
    if (!vectorSource) return;
    vectorSource.clear();
    if (!currentParcelData || !currentParcelData.vertices || currentParcelData.vertices.length === 0) return;
    
    // Transform coordinates adding current user georef offset shift
    const coords = currentParcelData.vertices.map(v => [
        v.lon + offsetX,
        v.lat + offsetY
    ]);
    
    // Polygon must be closed (start == end) in OpenLayers
    if (coords.length > 0 && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
        coords.push(coords[0]);
    }
    
    const polyGeom = new ol.geom.Polygon([coords]);
    const feature = new ol.Feature({
        geometry: polyGeom
    });
    
    feature.set('segment_lengths', currentParcelData.segments.map(s => s.length_meters));
    vectorSource.addFeature(feature);
}

// Zoom map view to shifted parcel bounding box
function zoomToParcel() {
    if (!currentParcelData || !currentParcelData.vertices || currentParcelData.vertices.length === 0) return;
    
    const lons = currentParcelData.vertices.map(v => v.lon);
    const lats = currentParcelData.vertices.map(v => v.lat);
    
    const xmin = Math.min(...lons) + offsetX;
    const xmax = Math.max(...lons) + offsetX;
    const ymin = Math.min(...lats) + offsetY;
    const ymax = Math.max(...lats) + offsetY;
    
    map.getView().fit([xmin, ymin, xmax, ymax], {
        size: map.getSize(),
        duration: 1000
    });
}

// Helper: Reset dropdowns below a certain level
function resetDropdownsFrom(levelNumber) {
    for (let l = levelNumber; l <= 7; l++) {
        const selectId = getSelectIdForLevel(l);
        const $select = $(`#${selectId}`);
        $select.empty().append(`<option value="">--Select ${getLevelLabel(l)}--</option>`);
        $select.prop("disabled", true);
    }
}

// Helper: Map Level to Select ID
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

// Helper: Map Level to human-readable labels
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

// Helper: Toggle Loading Overlay
function showLoading(show, text = "Loading...") {
    const $loader = $("#loading");
    $("#loading-text").text(text);
    if (show) {
        $loader.addClass("active");
    } else {
        $loader.removeClass("active");
    }
}

// Helper: Toast Notifications
let toastTimeout;
function showToast(message, type = "info") {
    clearTimeout(toastTimeout);
    const $toast = $("#toast");
    const $icon = $("#toast-icon");
    $("#toast-message").text(message);

    // Reset styles
    $icon.removeClass("warning error success info");
    
    if (type === "warning") $icon.addClass("fa-exclamation-triangle warning");
    else if (type === "error") $icon.addClass("fa-times-circle error");
    else if (type === "success") $icon.addClass("fa-check-circle success");
    else $icon.addClass("fa-info-circle info");

    $toast.addClass("active");
    
    toastTimeout = setTimeout(() => {
        $toast.removeClass("active");
    }, 4000);
}
