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
 * A generic Flot plot, do be used by any instrument that requires it
 *
 *
 * @author Edouard Lafargue, ed@lafargue.name
 */

define(function (require) {
    "use strict";

    var $ = require('jquery'),
        _ = require('underscore'),
        utils = require('app/utils'),
        Backbone = require('backbone');

    // Load the flot library & flot time plugin:
    require('flot');
    require('flot_time');
    require('flot_selection');
    require('flot_fillbetween');
    require('flot_crosshair');

    return Backbone.View.extend({

        initialize: function (options) {

            // Beware: we define "this.rsc" here because if we define it as a "var" on top, the requireJS caching
            // mechanism will turn it into one single reference for every flotplot instance, which is not what we want!
            // Make sure the chart takes all the window height:
            this.rsc = null;

            // Here are all the options we can define, to pass as "settings" when creating the view:
            this.flotplot_settings = {
                // points: 150,
                // duration: 600,  // Max age of datapoints in seconds (older will be removed)
                // preload: 4096,  // Use this when creating a plot with a fixed number of data points
                // (used for the Sigma-25)
                // log: false,     // Override log display
                showtips: true,
                selectable: false,
                vertical_stretch: false, // Stretch relative to window height
                vertical_stretch_parent: false, // Stretch relative to parent height
                multiple_yaxis: false,
                plot_options: {
                    xaxis: {
                        mode: "time",
                        show: true,
                        timeformat: "%Y.%m.%d<br>%H:%M",
                        timezone: settings.get("timezone")
                    },
                    grid: {
                        hoverable: true,
                        clickable: true
                    },
                    legend: {
                        position: "ne",
                        // container: $('#legend')
                    },
                    colors: [(settings.get('default_graph_color') ? settings.get('default_graph_color') : "#e27c48"), "#5a3037", "#f1ca4f", "#acbe80", "#77b1a7", "#858485", "#d9c7ad"],
                },

                get: function (key) {
                    return this[key];
                },
            };



            // Replace defaults by our own config for all keys
            // passed - if any
            if (options && options.settings) {
                for (var prop in options.settings) {
                    if (prop != 'plot_options')
                        this.flotplot_settings[prop] = options.settings[prop];
                }
                // Also copy the plot options (don't just upate the reference, otherwise
                // this causes random issues when using the same options objects for initializing
                // several plots
                if ('plot_options' in options.settings) {
                    for (var prop in options.settings.plot_options) {
                        this.flotplot_settings.plot_options[prop] = options.settings.plot_options[prop];
                    }
                }
            }

            // livedata is an array of all readings.
            // We can have multiple values plotted on the chart, so this is
            // an array of arrays.
            this.livedata = [];
            this.sensors = [];
            this.sensor_options = [];
            this.plotData = [];
            this.previousPoint = null;

            this.plotOptions = this.flotplot_settings.plot_options;

            if (this.flotplot_settings.selectable) {
                // Extend the plot options to make it possible to do XY selections
                this.plotOptions.selection = {
                    mode: "xy"
                };

            }
        },

        // We have to call onClose when removing this view, because otherwise
        // the window resize callback lives on as a zombie and tries to resize
        // any chart anywhere...
        onClose: function () {
            if (this.flotplot_settings.vertical_stretch ||
                this.flotplot_settings.vertical_stretch_parent) {
                $(window).off('resize', this.rsc);
            }

            try {
                // Explicitely destroy the plot, otherwise we will leak DOM references and
                // memory (https://github.com/flot/flot/issues/1129)
                if (this.plot)
                    this.plot.destroy();
            } catch (err) {
                console.log('Plot destroy error', err);
            }
        },

        render: function () {
            console.log("Rendering a simple chart widget");
            this.$el.html('<div class="chart" style="position: relative; width:100%; height: 100px;"></div>');
            this.addPlot();
            return this;
        },

        addPlot: function () {
            var self = this;
            // Now initialize the plot area:
            // this.plotOptions.legend = { container: $('#legend',this.el) };

            // In some instances, we get an error here, depending on how/when we
            // called the initialization. if that's the case, then just retry automatically
            // after 250ms
            try {
                this.plot = $.plot($(".chart", this.el), [{
                    data: [],
                    label: "",
                    color: this.color
            }], this.plotOptions);
            } catch (e) {
                setTimeout(this.addPlot, 250);
                return;
            }

            // Adjust whether we want a log display, or linear (setup in global settings)
            var log_disabled = (this.flotplot_settings.log) && (this.flotplot_settings.log == false);
            if (settings.get('cpmscale') == "log") {
                this.plotOptions.yaxis = {
                    min: 1,
                    //ticks: [1,10,30,50,100,500,1000,1500],
                    transform: function (v) {
                        return Math.log(v + 10);
                    },
                    inverseTransform: function (v) {
                        return Math.exp(v) - 10;
                    }
                };
            }
            if (('yaxis' in this.plotOptions) || log_disabled) {
                delete this.plotOptions.yaxis.min;
                delete this.plotOptions.yaxis.transform;
                delete this.plotOptions.yaxis.inverseTransform;
            }

            // Add Tooltips
            if (!this.flotplot_settings.showtips)
                return;

            $(".chart", this.el).bind("plothover", function (event, pos, item) {
                if (item) {
                    $("#tooltip").remove();
                    var x = item.datapoint[0],
                        y = item.datapoint[1];

                    self.showTooltip(item.pageX, item.pageY,
                        "<small>" + ((self.plotOptions.xaxis.timezone) ?
                            ((self.plotOptions.xaxis.timezone === 'UTC') ?
                                new Date(x).toUTCString() :
                                new Date(x).toString()) : x) + "</small><br>" + item.series.label + ": <strong>" + y + "</strong>");
                } else {
                    $("#tooltip").remove();
                }
            });

            // Connect overview and main charts
            if (this.flotplot_settings.selectable) {
                $(".chart", this.el).on("plotselected", function (event, ranges) {

                    // clamp the zooming to prevent eternal zoom

                    if (ranges.xaxis.to - ranges.xaxis.from < 0.00001) {
                        ranges.xaxis.to = ranges.xaxis.from + 0.00001;
                    }

                    if (ranges.yaxis.to - ranges.yaxis.from < 0.00001) {
                        ranges.yaxis.to = ranges.yaxis.from + 0.00001;
                    }

                    // Save the current range so that switching plot scale (log/linear)
                    // can preserve the zoom level:
                    self.ranges = ranges;

                    // do the zooming
                    self.plotOptions = $.extend(true, {}, self.plotOptions, {
                        xaxis: {
                            min: ranges.xaxis.from,
                            max: ranges.xaxis.to
                        },
                        yaxis: {
                            min: ranges.yaxis.from,
                            max: ranges.yaxis.to
                        }
                    });

                    self.render();
                    self.redraw();

                    // Pass event onwards
                    self.trigger("plotselected", event, ranges);
                });
            }

            $('.chart', this.el).css('height', this.$el.parent().css('height'));
            if (this.flotplot_settings.vertical_stretch ||
                this.flotplot_settings.vertical_stretch_parent) {
                var self = this;
                var rsc = function () {
                    var chartheight;
                    if (self.flotplot_settings.vertical_stretch) {
                        chartheight = window.innerHeight - $(self.el).offset().top - 20;
                        if (settings.get("showstream"))
                            chartheight -= ($('#showstream').height() + 20);
                    } else {
                        chartheight = $(self.el.parentElement).height();
                    }
                    $('.chart', self.el).css('height', chartheight + 'px');
                    // Manually resize the plot (no need for the Flot-resize plugin
                    // to do this, since it adds stupid timers and other niceties...
                    self.plot.resize();
                    self.plot.setupGrid();
                    self.plot.draw();

                }
                this.rsc = rsc;
                $(window).on('resize', this.rsc);
                rsc();
            }
        },

        autoResize: function() {
            if (this.rsc)
                this.rsc();
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

        // Clears all graph data
        clearData: function () {
            this.livedata = [];
            this.sensors = [];
        },


        trimLiveData: function (idx) {
            if (this.livedata[idx].length >= this.flotplot_settings.points) {
                this.livedata[idx].shift(); // Should be 40% faster than slice(1)
            }
        },

        /**
         * Remove any data that is older than our max graph duration, for all
         * graphed values
         */
        trimOldData: function(ts) {
            for (var ld in this.livedata) {
                if (this.livedata[ld].length && this.livedata[ld][0])
                    while (this.livedata[ld][0][0] < ts - this.flotplot_settings.duration*1000) {
                        this.livedata[ld].shift();
                    }
            }
        },

        /**
         * Append a data point. Data should be in the form of
         * { name: "measurement_name", value: value } or
         * { name: "measurement_name", value: value, timestamp: timestamp } or
         * { name" "measurement_name", value: value, index: index }
         * You can also add an "options" key to pass additional config for plotting:
         * { name: "sensor_name", value: value, timestamp: timestamp, options: {lines: {show: true,fill: true},fillBetween: "vmin"}}
         *  Note: you can only set the options once.
         */
        fastAppendPoint: function (data) {
            var sensor = data.name;
            var idx = this.sensors.indexOf(sensor);
            if (idx == -1) {
                this.sensors.push(sensor);
                var options = data.options ? data.options : {};
                this.sensor_options.push(options);
                var a = [];
                if (this.flotplot_settings != undefined) {
                    for (var i = 0; i < this.flotplot_settings.preload; i++)
                        a[i] = [i, 0];
                }
                this.livedata.push(a);
                idx = this.sensors.length - 1;
            }
            if (this.flotplot_settings.points) this.trimLiveData(idx);
            if (data.index != undefined) {
                this.livedata[idx][data.index] = [data.index, data.value];
            } else if (data.xval != undefined) {
                this.livedata[idx].push([data.xval, data.value]);
            } else {
                var stamp = (data.timestamp != undefined) ? new Date(data.timestamp).getTime() : new Date().getTime();
                if (this.flotplot_settings.duration ) this.trimOldData(stamp);
                this.livedata[idx].push([stamp, data.value]);
            }
            return this; // This lets us chain multiple operations
        },

        redraw: function () {
            var plotData = [];
            // Now pack our live data:
            for (var i = 0; i < this.sensors.length; i++) {
                var v = {
                    data: this.livedata[i],
                    label: this.sensors[i],
                    yaxis: (this.flotplot_settings.multiple_yaxis) ? i + 1 : 1
                };
                plotData.push(utils.collate(v, this.sensor_options[i]));
            }
            // Now update our plot
            this.plot.setData(plotData);
            this.plot.setupGrid();
            this.plot.draw();
        },

        // This method forces a redraw and is slow: use fastAppendPoint for
        // loading a large number of points before redrawing
        appendPoint: function (data) {
            this.fastAppendPoint(data);
            // Save lots of battery by skipping the redraw when the plot is running
            // in a Cordova app and the app is not in front (screen off, etc)
            if (vizapp.state == 'paused')
                return;
            this.redraw();
            return this; // This lets us chain multiple operations
        }

    });

});