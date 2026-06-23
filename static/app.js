// Bihar Cadastral Map & Satellite Dashboard GIS Logic

let map;
let plotLyr;
let selPlotLyr;
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

    // Setup map view centered on Patna, Bihar
    map = new ol.Map({
        target: "map",
        layers: [googleSatelliteLayer, plotLyr, selPlotLyr],
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
            if (data && data.id) {
                // Set details
                $("#val-plot-no").text(data.kide || "--");
                $("#val-plot-id").text(data.id || "--");
                $("#val-pniu").text("--"); // Not returned directly by getPlotAtXY
                $("#val-lat").text(lat.toFixed(6));
                $("#val-lon").text(lon.toFixed(6));

                // Update WMS highlight
                selPlotLyr.getSource().updateParams({
                    "gis_code": currentGisCode,
                    "plot_id": data.id
                });
                selPlotLyr.setVisible(true);
                showToast(`Selected Plot No: ${data.kide}`, "success");
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
        
        // Extents (GPS)
        const xmin = parseFloat(parts[6]);
        const ymin = parseFloat(parts[7]);
        const xmax = parseFloat(parts[8]);
        const ymax = parseFloat(parts[9]);

        // Update UI details
        $("#val-plot-no").text(plotNo);
        $("#val-plot-id").text(plotId);
        $("#val-pniu").text(pniu);
        $("#val-lat").text(centerLat.toFixed(6));
        $("#val-lon").text(centerLon.toFixed(6));

        // Highlight selected plot
        selPlotLyr.getSource().updateParams({
            "gis_code": currentGisCode,
            "plot_id": plotId
        });
        selPlotLyr.setVisible(true);

        // Zoom to shifted parcel bounds
        map.getView().fit([xmin + offsetX, ymin + offsetY, xmax + offsetX, ymax + offsetY], {
            size: map.getSize(),
            duration: 1000
        });

        showToast(`Plot ${plotNo} resolved and highlighted!`, "success");
    }, "text").fail(function() {
        showLoading(false);
        showToast("Failed to search PNIU code", "error");
    });
}

// Helper: Clear Details Sidebar
function clearDetails() {
    $("#val-plot-no").text("--");
    $("#val-plot-id").text("--");
    $("#val-pniu").text("--");
    $("#val-lat").text("--");
    $("#val-lon").text("--");
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
