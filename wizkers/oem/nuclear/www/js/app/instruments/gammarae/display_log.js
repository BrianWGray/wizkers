/**
 * This file is part of Wizkers.io
 *
 * The MIT License (MIT)
 *  Copyright (c) 2016 Edouard Lafargue, ed@wizkers.io
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software
 * is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
 * IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/*
 * Log view for the GammaRAE.
 *
 * Our model is a collection of Logs
 *
 * @author Edouard Lafargue, ed@lafargue.name
 */

define(function (require) {
    "use strict";

    var $ = require('jquery'),
        _ = require('underscore'),
        Backbone = require('backbone'),
        simpleplot = require('app/lib/flotplot'),
        utils = require('app/utils'),
        fileutils = require('app/lib/fileutils'),
        template = require('js/tpl/instruments/gammarae/LogView.js');

    return Backbone.View.extend({

        initialize: function () {
            var self = this;

            this.deviceLogs = this.collection;
            this.previousPoint = null;

            // Need this to make sure "render" will always be bound to our context.
            // -> required for the _.after below.
            _.bindAll(this, "render");

            // We will pass this when we create plots, this is the global
            // config for the look and feel of the plot
            this.plotSettings = {
                selectable: true,
                vertical_stretch: true,
                points: 0,
                plot_options: {
                    xaxis: {
                        mode: "time",
                        show: true,
                        timeformat: "%Y.%m.%d<br>%H:%M",
                        timezone: settings.get("timezone"),
                    },
                    yaxis: {},
                    grid: {
                        hoverable: true,
                        clickable: true
                    },
                    legend: {
                        position: "ne"
                    },
                    colors: this.palette,
                }
            };

            this.plotOverviewSettings = {
                selectable: true,
                vertical_stretch: false,
                points: 0,
                plot_options: {
                    xaxis: {
                        mode: "time",
                        show: true,
                        timeformat: "%m.%d",
                        timezone: settings.get("timezone"),
                    },
                    yaxis: {},
                    colors: this.palette,
                }
            };


            // TODO: save color palette in settings ?
            // My own nice color palette:
            this.palette = ["#e27c48", "#5a3037", "#f1ca4f", "#acbe80", "#77b1a7", "#858485", "#d9c7ad"];

            // Now fetch all the contents, then render
            var renderGraph = _.after(this.deviceLogs.length, this.render);
            this.deviceLogs.each(function (log) {
                log.entries.fetch({
                    success: renderGraph,
                    xhr: function () {
                        var xhr = $.ajaxSettings.xhr();
                        xhr.onprogress = self.handleProgress;
                        return xhr;
                    }
                });
            });

        },

        handleProgress: function (e) {
            $('#loadtext').html("Loaded: " + e.loaded + " bytes");
        },

        events: {
            "click .resetZoom": "resetZoom",
            "click #cpmscale": "cpmScaleToggle",
            "click .ctrl-edit": "editLog",
            "click #download-csv": "downloadCSV"
        },

        resetZoom: function () {
            delete this.ranges;
            this.plot.plotOptions = this.plotSettings.plot_options;
            this.plot.addPlot();
            this.plot.redraw();
            return false;
        },

        cpmScaleToggle: function (event) {
        },

        editLog: function () {
            console.log('Edit Log');
            var logIds = [];
            _.each(this.deviceLogs.models, function (log) {
                logIds.push(log.id);
            });
            router.navigate('editlogs/' + instrumentManager.getInstrument().id + '/' + logIds.join(','), true);
        },

        render: function () {
            var self = this;
            console.log('Main render of Log details view');

            this.$el.html(template());

            this.addPlot();
            this.packData();

            return this;
        },

        onClose: function () {
            console.log("Log management view closing...");

            // Remove the window resize bindings on our plots:
            this.plot.onClose();
            if (this.overview)
                this.overview.onClose();
            // Restore the settings since we don't want them to be saved when changed from
            // the home screen
            settings.fetch();
        },

        downloadCSV: function () {
            var header = 'data:text/csv; charset=utf-8,\n';
            var csv = header + "Timestamp (UTC), ";
            for (var i = 0; i < this.deviceLogs.length; i++) {
                var currentLog = this.deviceLogs.at(i);
                var entries = currentLog.entries;
                var type = currentLog.get('logtype');
                if (type == 'live') {
                    csv += "CPM, CPM30, USV, COUNT, Valid, latitude, longitude, altitude, accuracy, loc_status\n";
                } else if (entries.at(0) && entries.at(0).get('data').min != undefined) {
                    // We have new generation log type with min/max values
                    csv += "cpm, cpm_min, cpm_max, counts, duration (s), is_cpm_30, time on device (ISO String)\n";
                    type = "min_max";
                } else {
                    csv += "accel_x_start, accel_x_end, accel_y_start, accel_y_end, accel_z_start, accel_z_end, cpm, duration (s), time on device (ISO String)\n";
                }
                for (var j = 0; j < entries.length; j++) {
                    var entry = entries.at(j);
                    var data = entry.get('data');
                    // Sometimes, we get entries without a valid CPM reading, detect this
                    if (data.cpm) {
                        // No known spreadsheet software handles ISO8601 dates
                        // properly (like 2014-06-17T18:00:04.067Z ) so we
                        // convert the timestamp to a string that is recognized by
                        // Excel or Google Docs. The whole new Date + toISOString
                        // is here to guarantee that we do get a proper formatted
                        // time stamp whenever we are running as an embedded app or a server
                        // app.
                        var ts = new Date(entry.get('timestamp')).toISOString().replace(/[TZ]/g, ' ');
                        csv += ts;
                        // Our live data is packed a bit differently than onyxlog data
                        // Note: I tried a generic "for key in data" but the order
                        // the keys are returned can change randomly, leading to wrong outout, which is
                        // why I am using explicit key names:
                        if (type == 'live') {
                            csv += ',' + data.cpm.value +
                                ',' + data.cpm.cpm30 +
                                ',' + data.cpm.usv +
                                ',' + data.cpm.count +
                                ',' + data.cpm.valid;
                        } else if (type == 'min_max') {
                            csv += ',' + data.cpm +
                                ',' + data.min +
                                ',' + data.max +
                                ',' + data.counts +
                                ',' + data.duration +
                                ',' + data.type +
                                ',' + data.time;
                        } else {
                            csv += ',' + data.accel_x_start +
                                ',' + data.accel_x_end +
                                ',' + data.accel_y_start +
                                ',' + data.accel_y_end +
                                ',' + data.accel_z_start +
                                ',' + data.accel_z_end +
                                ',' + data.cpm +
                                ',' + data.duration +
                                ',' + data.time;
                        }
                        if (data.loc) {
                            csv += ',' + data.loc.coords.latitude +
                                ',' + data.loc.coords.longitude +
                                ',' + data.loc.coords.altitude +
                                ',' + data.loc.coords.accuracy +
                                ',' + data.loc_status;
                        }
                        csv += '\n';
                    }
                }
            }
            var uri = encodeURI(csv);
            if (vizapp.type != 'cordova') {
                window.open(uri);
            } else {
                var self = this;
                // In Cordova mode, we create a file
                var fname = 'onyxlog-' + new Date().getTime() + '.csv';
                fileutils.newLogFile(fname, function (file) {
                    file.createWriter(function (fileWriter) {
                        fileWriter.write(csv);
                        $('#errorreason', self.el).html('Log saved');
                        $('#errordetail', self.el).html('Your logfile was saved on your device in "Wizkers/logs/' + fname + '"');
                        $('#ErrorModal').modal();
                    });
                });
            }
        },

        addPlot: function () {
            var self = this;

            if (this.deviceLogs == null ||  this.deviceLogs.length == 0)
                return;

            $('#log_size', this.el).html(this.deviceLogs.getOverallLength());
            $('#log_start', this.el).html(new Date(this.deviceLogs.getLogsStart()).toString());
            $('#log_end', this.el).html(new Date(this.deviceLogs.getLogsEnd()).toString());

            this.plot = new simpleplot({
                model: this.model,
                settings: this.plotSettings
            });

            // We don't create an overview on small screens, does not make sense
            if (!(utils.checkBreakpoint('sm') || utils.checkBreakpoint('xs'))) {
                this.overview = new simpleplot({
                    model: this.model,
                    settings: this.plotOverviewSettings
                });
            }

            if (this.overview) {
                $('#overview', this.el).empty().append(this.overview.el);
                this.overview.render();
            } else {
                $('#overview-container', this.el).empty();
            }

            // Only render the plot after the overview is (maybe) removed, so that
            // it stretches properly
            if (this.plot != null) {
                $('.geigerchart', this.el).empty().append(this.plot.el);
                this.plot.render();
            }

            // Restore current zoom level if it exists:
            if (this.ranges) {
                this.plot.plotOptions = $.extend(true, {}, this.plotSettings.plot_options, {
                    xaxis: {
                        min: this.ranges.xaxis.from,
                        max: this.ranges.xaxis.to
                    },
                    yaxis: {
                        min: this.ranges.yaxis.from,
                        max: this.ranges.yaxis.to
                    }
                });
            }

        },


        // Depending on log type, we need to pack our data differently...
        packData: function () {
            var self = this;
            // Create a table of Y values with the x values from our collection
            var logs = this.deviceLogs;
            // At this stage we know the logs are already fetched, btw
            for (var j = 0; j < logs.length; j++) {
                var value = logs.at(j).entries;
                var type = logs.at(j).get('logtype');
                for (var i = 0; i < value.length; i++) {
                    var entry = value.at(i);
                    // Be sure we only plot CPM entries (we might have anything in the
                    // log...
                    var stamp = new Date(entry.get('timestamp')).getTime();
                    var dd = parseFloat((type == 'dose') ? entry.get('data') : entry.get('data'));
                    this.plot.fastAppendPoint({
                        name: '&mu;Sv',
                        value: dd,
                        timestamp: stamp
                    });
                    if (this.overview)
                        this.overview.fastAppendPoint({
                            name: '&mu;Sv',
                            value: dd,
                            timestamp: stamp
                        });
                }
            }
            this.plot.redraw();
            if (this.overview)
                this.overview.redraw();
            return;
        },

        // Ugly at this stage, just to make it work (from flotcharts.org examples)
        showTooltip: function (x, y, contents) {
            $("<div id='tooltip' class='well'>" + contents + "</div>").css({
                position: "absolute",
                display: "none",
                top: y + 5,
                left: x + 5,
                padding: "3px",
                opacity: 0.90
            }).appendTo("body").fadeIn(200);
        },

    });
});