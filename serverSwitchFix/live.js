// Constants: CHANGE THIS FOR NEW ACCOUNT OR VIZ (1 of 2)
var SQL_API_PREFIX = 'http://sweeten.cartodb.com/api/v2/sql?q=',
    SQL_API_TABLE = 'swmasterfinalall_updatedto_dec2013';
    SQL_API_TABLE_SW= 'portfolios_projects_sweetengeov2';

// Initial values
var initialDateMin = new Date(2013, 0, 2),
    initialDateMax = new Date(2014, 1, 1);

// Global state variables
var dateMin = moment(initialDateMin).format('YYYY-MM-DD'),
    dateMax = moment(initialDateMax).format('YYYY-MM-DD'),
    sublayers = [],
    map,
    dobLayer,
    sweetenLayer;

// Build the SQL for the layer that will be displayed
function buildSQL() {
    var baseQuery = "SELECT * FROM " + SQL_API_TABLE;
    var conditions = buildSQLWhereConditions();
    return [baseQuery, conditions].join(' WHERE ')+ ' ORDER BY initial_cost DESC';


}

// Build just the WHERE conditions for the SQL query
function buildSQLWhereConditions() {
    var conditions =
        "pre__filing_date >= '" + dateMin + "'::DATE AND " +
        "pre__filing_date < '" + dateMax + "'::DATE";

    // Get the initial cost conditions
    var expensiveness_conditions = [];
    $(':checkbox:checked:not([data-sweeten])').each(function (i, checkbox) {
        // Add a condition for each checked box
        var lessthan = $(checkbox).data('less-than');
        var greaterthan = $(checkbox).data('greater-than');

        var c = [];
        if (lessthan !== undefined) {
            c.push('initial_cost <= ' + lessthan);
        }
        if (greaterthan !== undefined) {
            c.push('initial_cost > ' + greaterthan);
        }

        expensiveness_conditions.push('(' + c.join(' AND ') + ')');
    });
    if (expensiveness_conditions.length !== 0) {
        conditions += ' AND (' + expensiveness_conditions.join(' OR ') + ')';
    }
    else {
        // No checkboxes selected--don't show any permit data
        conditions += ' AND initial_cost < 0';
    }

    return conditions;
}

// Update the display layer's SQL
function updatePermitLayerSQL() {
    if (sublayers[0] !== undefined) {
        sublayers[0].setSQL(buildSQL());
    }
}

// Get all the rows very near to the given point, send back just
// the rows to the given callback function
function getDataNearPoint(latlng, callback) {
    var nearbyDataSql =
        "SELECT * FROM " + SQL_API_TABLE + " " +
        "WHERE ST_DWithin( " +
          "the_geom, " +
          "ST_GeomFromText( " +
            "'POINT(" + latlng[1] + " " + latlng[0] + ")', " +
            "4326 " +
          "), " +
          "0.00001" +
        ")";

    // Add the standard WHERE conditions
    var sql = nearbyDataSql + ' AND ' + buildSQLWhereConditions();

    // Order by the filing date
    sql += ' ORDER BY pre__filing_date';
    $.getJSON(SQL_API_PREFIX + sql, function (data) {
        callback(data.rows);
    });
}

function getDataForBIN(bin, callback) {
    // Only these columns are pulled from CartoDB
    var columns = [
        '_display',
        'job__',
        'bin__',
        'addressss',
        'initial_cost',
        "to_char(cast(total_est_fee as double precision), '999,999,999') AS total_est_fee",
        'owner_s_first_last_name',
        'applicant_s_first_last_name',
        'applicant_professional_title',
        'job_description'
    ];
    var sql =
        'SELECT ' + columns.join(',') + ' ' +
        'FROM ' + SQL_API_TABLE + ' ' +
        "WHERE bin__ = '" + bin + "'";
    sql += ' AND ' + buildSQLWhereConditions() + ' ORDER BY initial_cost DESC';
    $.getJSON(SQL_API_PREFIX + sql, function (data) {
        callback(data.rows);
    });
}

// Initialize the sublayer that holds job points
function initializePermitSublayer(sublayer) {
    var subLayerOptions = {
        sql: buildSQL()
    };
    sublayer.set(subLayerOptions);
    sublayer.setInteraction(true);
    sublayer.setInteractivity(['cartodb_id', 'latitude', 'longitude', 'bin__']);

    sublayer.on('featureClick', function (e, latlng, pos, data, layer) {
        getDataForBIN(data['bin__'], function (data) {
          var content = Mustache.render($('#infowindow_template').html(), {
            download: (function() {
              csvContent = "data:text/csv;charset=utf-8,";
              data.forEach(function(info, index){
                if (index == 0) {
                  keys = [];
                  for(k in info) keys.push(k);
                  csvContent += '"' + keys.join('","') + '"';
                  csvContent += "\n";
                }
                vals = [];
                for(k in info) vals.push(info[k]);
                csvContent += '"' + vals.join('","') + '"';
                csvContent += "\n";
              });

              return encodeURI(csvContent);
            })(),
            filename: data[0].addressss.replace(/\s/g, '-'),
            rows: data.map(function(d) {
              splitName = d['applicant_s_first_last_name'].split(' ');
              d['lastName'] = splitName[splitName.length - 1];
              d['initial_cost'] = d['initial_cost'].toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
              d['filename'] = d['addressss'].replace(/\W/g, '-');
              return d;
            })
          });

            //control popup width and height here
            L.popup()
                .setLatLng(latlng)
                .setContent(content)
                .openOn(map);
        });
    });

    // Turning infowindow off makes the cursor no longer
    // become a pointer when the mouse is over a feature.
    // Fix that here.
    sublayer.on('featureOver', function (e, latlng, pos, data, layer) {
        $('#map').css('cursor', 'pointer');
    });

    sublayer.on('featureOut', function (e, latlng, pos, data, layer) {
        $('#map').css('cursor', '-moz-grab');
        $('#map').css('cursor', '-webkit-grab');
    });
}

// Update the zoom{X} class on the map element. Nice for styling
// differently based on the map's zoom level
function updateZoomClass(map) {
    // Remove any previously set zoom classes
    for (var i = map.getMinZoom(); i <= map.getMaxZoom(); i++) {
        $('#map').removeClass('zoom' + i);
    }

    // Add current zoom class
    $('#map').addClass('zoom' + map.getZoom());
}

// Is the DOB layer currently being displayed on the map?
function dobLayerOn(map) {
    for (var l in map._layers) {
        if (map._layers[l] === dobLayer) {
            return true;
        }
    }
    return false;
}

var geocoder;
function findLatLong(address, map) {
    geocoder = new google.maps.Geocoder();
    geocoder.geocode( { 'address': address }, function(results, status) {
        if (status == google.maps.GeocoderStatus.OK) {
            var location = results[0].geometry.location;
            updateMap(map, location.lat(), location.lng());
        } else {
            alert("Geocode was not successful for the following reason: " + status);
        }
    });
}

function updateMap(map, lat, lon) {
    map.setView(new L.LatLng(lat, lon), 18);
    new L.CircleMarker([lat,lon],{radius: 4}).addTo(map);
}

$(document).ready(function () {

    map = L.map('map', {
        zoomControl: true,
        center: [40.7142, -74.0064],
        zoom: 14,
        maxZoom: 18,
        minZoom: 13,
        maxBounds:[[40.49,-74.26],[40.93,-73.655]]
    });
    updateZoomClass(map);

    //Mapbox tile layer
    L.tileLayer('http://a.tiles.mapbox.com/v3/zingbot.PermitBase/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: 'Mapbox'
    }).addTo(map);

    // layer id from the API: CHANGE THIS FOR A NEW ACCOUNT OR VIZ (2 of 2)
    var layerURL = 'http://sweeten.cartodb.com/api/v2/viz/a1bef5d0-afad-11e3-b8c2-0e230854a1cb/viz.json';

    cartodb.createLayer(map, layerURL, { infowindow: false })
       .addTo(map)
       .on('done', function(layer) {
            // Initialize sublayers
            var permitSublayer = layer.getSubLayer(0);
            initializePermitSublayer(permitSublayer);
            sublayers.push(permitSublayer);
            dobLayer = layer;
        })
        .on('error', function() {
            console.log("some error occurred");
        });

    // Initialize Sweeten projects layer
    var query = 'SELECT * FROM ' + SQL_API_TABLE_SW;
    var url = SQL_API_PREFIX + query + '&format=GeoJSON'
    $.getJSON(url, function (data) {

        // Initialize MarkerCluster layer
        sweetenLayer = new L.MarkerClusterGroup({
            showCoverageOnHover: false,
            singleMarkerMode: true,
            spiderifyOnMaxZoom: false,
            zoomToBoundsOnClick: false
        });

        // Spiderfy when a cluster is clicked
        sweetenLayer.on('clusterclick', function (cluster) {
            cluster.layer.spiderfy();
        });

        // Initialize layer using GeoJSON data
        var geojsonLayer = L.geoJson(data, {

            onEachFeature: function (feature, layer) {
                var content = Mustache.render($('#sweeten_infowindow_template').html(), feature.properties);
                layer.bindPopup(content, {
                    offset: [0, 0]
                });
            }

        });

        // Add GeoJSON layer to MarkerCluster layer
        sweetenLayer.addLayer(geojsonLayer);
    });

    // Always update the zoom class when zoom happens
    map.on('zoomend', function () {
        updateZoomClass(map);
    });

    // Initialize the date slider
    $('#slider').dateRangeSlider({
        arrows: false,
        bounds: {
            // 0-based months
            min: new Date(2003, 1, 1),
            max: new Date(2013, 11, 1)
        },
        defaultValues: {
            min: initialDateMin,
            max: initialDateMax
        },
        formatter: function (val) {
            return moment(val).format('MMM YYYY');
        },
        step: {
            months: 1
        }
    });

    // Add event handlers to date slider
    $('#slider').bind('valuesChanged', function (e, data) {
        // Update global state variables
        dateMin = moment(data.values.min).format('YYYY-MM-DD');

        // Add a month so we can ask for records less than dateMax
        // and still get records in the max month
        dateMax = moment(data.values.max).add('months', 1).format('YYYY-MM-DD');

        // Update the SQL of the layer
        updatePermitLayerSQL();
    });

    $('#search-form').bind('submit', function (e) {
        findLatLong($('#search').val(), map);
        e.preventDefault();
    });
});

$(document).on('change', ':checkbox:not([data-sweeten])', function() {
    updatePermitLayerSQL();

    // If DOB layer is not currently being displayed, hide the
    // Sweeten layer and show the DOB layer
    if (!dobLayerOn(map)) {
        map.removeLayer(sweetenLayer);
        map.addLayer(dobLayer);

        // Also, uncheck Sweeten checkbox
        $(':checkbox[data-sweeten]').removeAttr('checked');
    }
});

// Add or remove sweeten layer on checkbox change
$(document).on('change', ':checkbox[data-sweeten]', function() {
    if ($(this).is(':checked')) {
        map.removeLayer(dobLayer);
        map.addLayer(sweetenLayer);
        $(':checkbox:not([data-sweeten])').removeAttr('checked');
    }
    else {
        map.removeLayer(sweetenLayer);
    }
});