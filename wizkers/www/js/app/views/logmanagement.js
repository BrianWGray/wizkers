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
 * Log management.
 *
 * Our model is the settings object.
 *
 * This is a generic view, all devices display this.
 *
 * @author Edouard Lafargue, ed@lafargue.name
 */

define(function (require) {

    "use strict";

    var $ = require('jquery'),
        _ = require('underscore'),
        Backbone = require('backbone'),
        template = require('js/tpl/LogManagementView.js');

    require('bootstrap');

    return Backbone.View.extend({

        initialize: function () {

            this.deviceLogs = this.collection;
            this.selectedLogs = [];
        },

        events: {
            "click a": "handleaclicks",
            "change .logcheckbox": "refreshLogList",
            "click .displaylog": "displayLog",
            "click .delete_log": "deleteLog",
            "click #do-delete": "doDeleteLog",
        },

        /* Nice way to disable an anchor button when it is disabled */
        handleaclicks: function (event) {
            if ($(event.currentTarget).attr('disabled'))
                event.preventDefault();
        },


        // Called when a checkbox is clicked
        refreshLogList: function () {
            var list = $('.logcheckbox', this.el);
            // Create a list of all checked entry IDs
            var entries = [];
            _.each(list, function (entry) {
                if (entry.checked)
                    entries.push(entry.value);
            });
            this.selectedLogs = entries;
            this.render();
        },

        displayLog: function () {
            if ($('.displaylog', this.el).attr('disabled'))
                return false;
            router.navigate('displaylogs/' + instrumentManager.getInstrument().id + '/' + this.selectedLogs.join(','), true);
            return false;
        },

        deleteLog: function (event) {
            var data = $(event.currentTarget).data();
            $('#do-delete', this.el).data('id', data.id);
            $('#deleteConfirm', this.el).modal('show');

        },

        doDeleteLog: function (event) {
            var self = this;
            var logToDelete = this.deviceLogs.get($(event.currentTarget).data('id'));
            var points = logToDelete.entries.size();
            var log_destroyed = false;
            var entries_destroyed = false;

            // Ask our user to be patient:
            $("#deleteConfirm .modal-body .intro", this.el).html("Deleting log, please wait...");

            // We want to listen for entry deletion events, the process is async and we don't
            // want to let the user continue while the backend is busy deleting stuff...
            this.listenTo(logToDelete[0], "entry_destroy", function (num) {
                entries_destroyed = true;
                console.log("Entry destroy callback");
                $("#entries-del", self.el).width(Math.ceil((1 - num / points) * 100) + "%");
                if (num <= 1) {
                    self.stopListening(logToDelete[0]);
                    // Depending on the situation, we might get there before
                    // actual log destoy success (see below)
                    if (log_destroyed) {
                        $('#deleteConfirm', self.el).modal('hide');
                        self.render();
                    }
                }
            });

            // Delete all entries (tested on Cordova)
            _.invoke(logToDelete.entries.toArray(), 'destroy');
            // Note: this makes the app work fine on Cordova, need to do tests
            // on NWJS and in server mode (more tricky on the latter)
            entries_destroyed = true;

            // Tested in real life on Cordova w/ PouchDB adapter: the logToDelete
            // is not yet removed from this.deviceLogs when the success callback is called
            // (probably bubbles up after the success callback?)
            // For this reason, the collection needs to listen for the removal of the log
            // before rendering
            this.listenToOnce(this.deviceLogs, "remove", function() {
                console.log("Log purged form list of instrument logs");
                self.$('#deleteConfirm').modal('hide');
                self.render();
            })

            // the backend will take care of deleting all the log entries associated with
            // the log.
            logToDelete.destroy({
                success: function (model, response) {
                    log_destroyed = true;
                    console.log("Log destroyed");
                },
                error: function (model, response) {
                    console.log("Log delete error" + response);
                }
            });
        },

        render: function () {
            var self = this;
            console.log('Main render of Log management view');

            // Sort the list of logs in chronological order
            var dl = this.collection.toJSON().sort(function (a, b) {
                return b.startstamp < a.startstamp ? 1 : a.startstamp < b.startstamp ? -1 : 0
            })

            this.$el.html(template({
                deviceLogs: dl,
                selected: this.selectedLogs,
                instrumentid: instrumentManager.getInstrument().id
            }));

            // Depending on device capabilities, enable/disable "device logs" button
            if (instrumentManager.getCaps().indexOf("LogManagementView") == -1 || !linkManager.isConnected()) {
                $('.devicelogs', self.el).attr('disabled', true);
            }

            // Now, we only want to scroll the table, not the whole page:
            var tbheight = window.innerHeight - $('#id1', this.el).height() - $('.header .container').height() - 20;
            $('#tablewrapper', this.el).css('max-height',
                tbheight + 'px'
            );

            return this;
        },

        onClose: function () {
            console.log("Log management view closing...");

            // Restore the settings since we don't want them to be saved when changed from
            // the home screen
            settings.fetch();
        },

    });
});