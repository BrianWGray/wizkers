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

/**
 * Extra settings for Blue Onyx counters. This is the Wizkers-side part, which
 * (for now) configures whether we want to display Google Maps or not.
 */
define(function (require) {
    "use strict";

    var $ = require('jquery'),
        _ = require('underscore'),
        utils = require('app/utils'),
        Backbone = require('backbone'),
        template = require('js/tpl/instruments/kestrel5/WizkersSettingsView.js');

    return Backbone.View.extend({

        initialize: function (options) {
            if (this.model.get('wizkers_settings') == undefined) {
                this.model.set('wizkers_settings', {
                    display_gmaps: (vizapp.type == 'cordova') ? 'true' : 'false',
                    display_graph: 'true',
                    screen_no_dim: 'false'
                });
            }
        },

        render: function () {
            // Those settings should only be available in Cordova mode because
            // we don't support maps in the Chrome app yet
            if (vizapp.type != 'cordova')
                return this;
            this.$el.html(template(this.model.toJSON()));
            return this;
        },

        events: {
            "change": "change",
        },

        change: function (event) {
            console.log("Settings change");

            // Apply the change to the model
            var target = event.target;
            var change = {};

            // Another refinement since I was not able to find another way:
            // sometimes in templates we are coding objects with object.key. The
            // target.name will then by a string called "object.key": catch this
            // and translate it into a proper reference to object.key (and not
            // a new key called "object.key". We only support one level of embedding
            var parts = target.name.split(".");
            if (parts.length > 1) {
                change[parts[0]] = this.model.get(parts[0]);
                if (change[parts[0]] == undefined)
                    change[parts[0]] = {};
                change[parts[0]][parts[1]] = target.value;
            } else {
                change[target.name] = target.value;
            }

            this.model.set(change);

            // This view is embedded into another view, so change events
            // are going to bubble up to the upper view and change attributes
            // with the same name, so we stop event propagation here:
            event.stopPropagation();

            this.model.save(null, {
                success: function (model) {
                },
                error: function () {
                    console.log('Instrument: error saving');
                    utils.showAlert('Error:', 'An error occurred while trying to save intrument config', 'alert-danger');
                }
            });
        },


    });
});