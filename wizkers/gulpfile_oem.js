var gulp = require('gulp');
var debug = require('gulp-debug');
var tap = require('gulp-tap');
var change = require('gulp-change');
var rename = require('gulp-rename');
var amdOptimize = require('amd-optimize');
var concat = require('gulp-concat');

var fs = require('fs');
var path = require('path');
var _ = require("underscore")._;
var _s = require('underscore.string');


gulp.task('default', function () {
    console.log("*******************");
    console.log("Targets: build chrome cordova server");
    console.log("*******************");
});


console.log ("OEM Build: " + process.env.OEM);

if (process.env.OEM == undefined) {
    console.error('***********************');
    console.error(' Error: you need to define the OEM env variable before calling gulp');
    console.error('for instance: OEM=safecast gulp --gulpfile gulpfile_oem.js');
    console.error('***********************');
    process.exit(1);
    
}   

var oem_directory = 'oem/' + process.env.OEM;

if (! fs.existsSync(oem_directory)) {
    console.error('The OEM directory you specified does not exist');
    process.exit(1);
}


var paths = {
    // Destination directories
    build: 'build', // Where we compile the templates and build the javascript distribution
    chrome_dist: 'dist/chrome/', // Where we distribute the Chrome app (ready for packaging for Chrome app store)
    // All javascript is minified there.
    chrome_debug: 'dist/chrome-debug/', // Debug build (not minified)
    cordova_debug: 'dist/cordova-debug/',
    cordova_dist: 'dist/cordova/',
    server_dist: 'dist/server/',

    // Application paths: (need to be in arrays)
    templates: ['www/js/tpl/**/*.html'],
    css: ['www/css/*', 'www/fonts/*', 'www/img/**/*'],
    libs: ['www/js/lib/**/*.js'],
    jsapp: ['www/js/app/**/*.js', 'www/js/app/**/*.png', 'www/js/app/**/*.svg'],

    // OEM Overlays which are common to all run modes (in www)
    oem_www_files: [ oem_directory + '/www/**/*.js', oem_directory + '/www/**/*.png', oem_directory + '/www/**/*.svg', oem_directory + '/www/css/*'],
    oem_www_templates: [oem_directory + '/www/js/tpl/**/*.html'],
    oem_server_files: [oem_directory + '/server/**/*'],

    // Files specific to each kind of run mode (chrome, cordova, server)
    server_files: ['server/**/*'],
    chrome_files: [oem_directory + '/chrome/**/*'],
    cordova_files: [oem_directory + '/cordova/**/*']
}

console.log(paths.templates);
/***************
 * Utilities
 */

var compileTemplate = function (contents) {
    try {
        var uTpl = "define(function(require) { ";
        //precompile template
        uTpl += "return " + _.template(contents).source + ";";
        uTpl += "});";
        return uTpl;
    } catch (e) {
        console.error('Could not compile a template for: ' + templates[templ] + " -- " + e.message);
    }
}

/**
 * Returns an array of all the directories below dir (can be an array
 * of muliple directories) with the 'glob' pattern added
 * @param   {Array}  dir  List of directories
 * @param   {String} glob Glob pattern like '/*.js'
 * @returns {Array}  List of all subdirectories with glob pattern
 */
function makeSrc(dir, glob) {
    var dirlist = getFolders(dir);
    return dirlist.map(function (arg) {
        return arg + glob;
    });
}

/*******************
 *  Tasks
 */


gulp.task('build', ['css', 'libs', 'jsapp', 'oem_www_overlay', 'templates', 'oem_templates']);

/**
 * Copies all files for the OEM into the build destination, before
 * doing the template calculation.
 *
 * We want to overlay after we copied all the original CSS and Javasscript.
 */
gulp.task('oem_www_overlay', ['css', 'jsapp'], function () {
    return gulp.src(paths.oem_www_files, {
            base: oem_directory
        })
        .pipe(gulp.dest(paths.build));
});

/**
 * Compile all OEM templates and (potentially) overwrites original templates, so
 * it has to happen after the 'templates' task
 */
gulp.task('oem_templates', ['templates'], function () {
    return gulp.src(paths.oem_www_templates, {
            base: oem_directory
        })
        .pipe(change(compileTemplate))
        // .pipe(debug())
        .pipe(rename(function (path) {
            path.extname = '.js';
        }))
        .pipe(gulp.dest(path.join(paths.build)));
});

/**
 * Compile all templates and copy them to the various dist directories
 */
gulp.task('templates', function () {
    return gulp.src(paths.templates, {
            base: '.'
        })
        .pipe(change(compileTemplate))
        // .pipe(debug())
        .pipe(rename(function (path) {
            path.extname = '.js';
        }))
        .pipe(gulp.dest(path.join(paths.build)));
});

/**
 * Copy all CSS files
 * TODO: Minimize for distribution
 */
gulp.task('css', function () {
    return gulp.src(paths.css, {
            base: '.'
        })
        .pipe(gulp.dest(paths.build));
});

/**
 * Same for the libraries
 */
gulp.task('libs', function () {
    return gulp.src(paths.libs, {
            base: '.'
        })
        .pipe(gulp.dest(paths.build));
});

gulp.task('jsapp', function () {
    return gulp.src(paths.jsapp, {
            base: '.'
        })
        .pipe(gulp.dest(paths.build));
});

/**
 * Copy the build files to the Chrome directory
 */
gulp.task('chrome_copy_build', ['build'], function () {
    return gulp.src([paths.build + '/www/**/*'], {
            base: paths.build
        })
        .pipe(gulp.dest(paths.chrome_debug));
});

/**
 * Build the Chrome app (debug, not minified)
 * This first does a build of the app, then
 * overlays all the files in paths.chrome_files
 */
gulp.task('chrome', ['build', 'chrome_copy_build'], function () {
    return gulp.src(paths.chrome_files, {
            base: oem_directory + '/chrome'
        })
        .pipe(gulp.dest(paths.chrome_dist))
        .pipe(gulp.dest(paths.chrome_debug));
});

/**
 * Copy the build files to the Cordova directory
 */
gulp.task('cordova_copy_build', ['build'], function () {
    return gulp.src([paths.build + '/www/**/*'], {
            base: paths.build
        })
        .pipe(gulp.dest(paths.cordova_debug));
});


/**
 * Build the Cordova app
 */
gulp.task('cordova', ['build', 'cordova_copy_build'], function () {
    return gulp.src(paths.cordova_files, {
            base: oem_directory + '/cordova'
        })
        .pipe(gulp.dest(paths.cordova_dist))
        .pipe(gulp.dest(paths.cordova_debug));
});

/**
 * Build the Server app. Note: the server overlay can overwrite some files, but won't
 * delete any.
 */
gulp.task('server', ['server_original', 'oem_server_overlay']);

gulp.task('oem_server_overlay', ['server_original'], function () {
    return gulp.src(paths.oem_server_files, {
            base: oem_directory + '/server'
        })
        .pipe(gulp.dest(paths.server_dist));
});

/**
 * Copy the build files to the server directory
 */
gulp.task('server_copy_build', ['build'], function () {
    return gulp.src([paths.build + '/www/**/*'], {
            base: paths.build
        })
        .pipe(gulp.dest(paths.server_dist));
});

gulp.task('server_original', ['build', 'server_copy_build'], function () {
    return gulp.src(paths.server_files, {
            base: 'server'
        })
        .pipe(gulp.dest(paths.server_dist));
});