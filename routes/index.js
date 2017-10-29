var express = require('express');
var router = express.Router();
var path = require('path');
var formidable = require('formidable'),
	http = require('http'),
	util = require('util'),
	fsExtra   = require('fs-extra');
var util = require('util'),
	stream = require('stream'),
	es = require("event-stream");
//Events
var events = require('events');
var eventEmitter = new events.EventEmitter();
var Line = require(path.join(__dirname, '..', 'libs', 'Line.js'));
var ScoresProcessor = require(path.join(__dirname, '..', 'libs', 'ScoresProcessor.js'));
var ScoreStatistics = require(path.join(__dirname, '..', 'libs', 'ScoreStatistics.js'));
var FailureGroups = require(path.join(__dirname, '..', 'libs', 'FailureGroups.js'));
var ControlLimits = require(path.join(__dirname, '..', 'libs', 'ControlLimits.js'));
var Sites = require(path.join(__dirname, '..', 'libs', 'Sites.js'));
var Stops = require(path.join(__dirname, '..', 'libs', 'Stops.js'));
var Reports = require(path.join(__dirname, '..', 'libs', 'Reports.js'));
 

function mixPayload(readingsList, areasList, text) {
	var mix = Reports.phaseMix(text);
	var yieldReport = Reports.yieldBySet(readingsList, areasList);
	return {
		phases: mix.phases,
		sets: Reports.attemptsReport(mix.sets, yieldReport.sets).sets,
		baseline: Reports.attemptsReport(mix.sets, yieldReport.sets).baseline,
		resolution: Reports.resolutionSteps(ScoreStatistics.summarise(readingsList))
	};
}

/* GET home page. */
router.get('/', function(req, res) {
	var count = Object.keys(req.app.get('mappings') || {}).length;
	res.render('index', { title: 'My App!!', partsText: count ? count + ' part names loaded' : 'No part names loaded' });
});

// Removes the saved part names, so the server has no names until a new file is uploaded.
router.post('/mapping/remove', function(req, res) {
    fsExtra.removeSync(req.app.get('mappingPath'));
    req.app.set('mappings', {});
    res.sendStatus(204);
});

router.post('/', function(req, res){
    console.log("Request handler 'upload' was called.");    
    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
        console.log("parsing done. files.data.name: "+(files.data ? files.data.name : undefined));
    });    
    // The two files arrive under their field names: data is the log, mapping is the part names.
    var logFile = null, mapFile = null;
    form.on('file', function(field, file) {
        if (field === 'mapping') { mapFile = file; } else { logFile = file; }
    });
    form.on('end', function(fields, files) {
        console.log("File received.");
        var mapDone = function() {
        if (!logFile || !logFile.name) { res.sendStatus(204); return; } // part names only
        var temp_path = logFile.path; //Temporary location of our uploaded file
        var file_name = logFile.name; //The file name of the uploaded file
        var pathname = path.join(req.app.get('uploads'),file_name) ; // Final location the uploaded file   
        fsExtra.copy(temp_path, pathname, function(err) {  
            if (! err) {
                console.log("success!");
                res.sendStatus(204); // answer the upload at once, the chart updates through /stream
                var summary = ScoreStatistics.summarise(ScoreStatistics.readScores(fsExtra.readFileSync(pathname, 'utf8')));
                var readingsList = ScoreStatistics.readScores(fsExtra.readFileSync(pathname, 'utf8'));
                                var logText = fsExtra.readFileSync(pathname, 'utf8');
                var mappingCsv = fsExtra.existsSync(req.app.get('mappingPath')) ? fsExtra.readFileSync(req.app.get('mappingPath'), 'utf8') : '';
                var checksNow = ScoreStatistics.readAreaResults(logText);
                var traceText = fsExtra.readFileSync(pathname, 'utf8');
                var traceReadings = ScoreStatistics.readScores(traceText);
                var traceAreas = ScoreStatistics.readAreaResults(traceText);
                eventEmitter.emit('bins', JSON.stringify(Reports.failureBins(ScoreStatistics.readScores(traceText))));
                eventEmitter.emit('trace', JSON.stringify({ routes: Reports.lineRoutes(traceText, traceReadings, traceAreas), kinds: Reports.lineKinds(traceText) }));
                var codeVersion = (function() { try { return require(path.join(__dirname, '..', 'package.json')).version + ' ' + require('child_process').execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return require(path.join(__dirname, '..', 'package.json')).version + ' (no git)'; } })();
                eventEmitter.emit('fingerprint', JSON.stringify(Reports.fingerprint(fsExtra.readFileSync(pathname), traceText, codeVersion)));
                eventEmitter.emit('scenarios', JSON.stringify(require(path.join(__dirname, '..', 'libs', 'Scenarios.js')).scenarios(traceText, mappingCsv)));
                eventEmitter.emit('checks', JSON.stringify({ gates: Reports.logChecks(logText, readingsList, checksNow, req.app.get('mappings')), mapping: Reports.mappingCheck(mappingCsv, readingsList), verdicts: Reports.verdictTable(checksNow) }));
                eventEmitter.emit('stats', JSON.stringify(summary));
                eventEmitter.emit('cameras', JSON.stringify(ScoreStatistics.summariseByCamera(readingsList)));
                eventEmitter.emit('sites', JSON.stringify(Sites.summariseBySite(readingsList, req.app.get('mappings'))));
                eventEmitter.emit('failures', JSON.stringify(FailureGroups.groupFailures(readingsList).map(function(g) { return { camera: g.camera, image: g.image, failed: g.failed, first: g.first, last: g.last }; })));
                eventEmitter.emit('control', JSON.stringify(ControlLimits.controlLimits(readingsList).map(function(x) { return { camera: x.camera, baseline: x.baseline, centre: x.centre, sd: x.sd, lower: x.lower, upper: x.upper, outside: x.outside.length, first_outside: x.outside.length ? x.outside[0].time + ' ' + x.outside[0].score : null }; })));
                eventEmitter.emit('stops', JSON.stringify(Stops.findStops(readingsList)));
                eventEmitter.emit('series', JSON.stringify(Stops.failureSeries(readingsList, ScoreStatistics.readAreaResults(fsExtra.readFileSync(pathname, 'utf8')))));
                eventEmitter.emit('report', JSON.stringify({ yield: Reports.yieldBySet(readingsList, ScoreStatistics.readAreaResults(fsExtra.readFileSync(pathname, 'utf8'))), utilisation: Reports.utilisation(readingsList, Stops.findStops(readingsList).stops), silent: Reports.silentSteps(Reports.yieldBySet(readingsList, ScoreStatistics.readAreaResults(fsExtra.readFileSync(pathname, 'utf8')))) }));
                var areasList = ScoreStatistics.readAreaResults(fsExtra.readFileSync(pathname, 'utf8'));
                eventEmitter.emit('areas', JSON.stringify({ deviation: Reports.areaDeviation(areasList), heatmap: Reports.heatmap(readingsList, areasList, 300) }));
                eventEmitter.emit('mix', JSON.stringify(mixPayload(readingsList, areasList, fsExtra.readFileSync(pathname, 'utf8'))));
                var yieldNow = Reports.yieldBySet(readingsList, areasList);
                eventEmitter.emit('flow', JSON.stringify({ funnel: Reports.logFunnel(fsExtra.readFileSync(pathname, 'utf8'), readingsList, areasList), flow: Reports.flowData(readingsList, areasList, Reports.silentSteps(yieldNow)) }));
                var yieldSummary = Reports.yieldBySet(readingsList, areasList);
                var utilSummary = Reports.utilisation(readingsList, Stops.findStops(readingsList).stops);
                eventEmitter.emit('summary', JSON.stringify(Reports.summaryLines({ yieldReport: yieldSummary, utilisation: utilSummary, stops: Stops.findStops(readingsList).stops, checks: Reports.checksList(readingsList, areasList) })));
                var scoresProcessor = new ScoresProcessor(req.app.get('mappings'), eventEmitter);
                var s = fsExtra.createReadStream(pathname)
	                .pipe(es.split())
	                .pipe(es.mapSync(function(line){	
	                    s.pause(); //pause the readstream
						var logEntry = new Line(line);
	                    (function(){// process line here and call s.resume() when ready
	                    	scoresProcessor.process(logEntry);
	                        s.resume(); // resume the readstream
	                    })();
	                })
	                .on('error', function(){
	                    console.log('Error while reading file.');
	                })
	                .on('end', function(){
	                    console.log('Read entirefile.');
	                })
                );       
            } else {
                console.error(err);
                res.sendStatus(500);
            }
        });       
        };
        if (mapFile && mapFile.path) {
            fsExtra.ensureDirSync(req.app.get('uploads'));
            fsExtra.copySync(mapFile.path, req.app.get('mappingPath'));
            req.app.get('loadMappings')(req.app.get('mappingPath'), mapDone);
        } else {
            mapDone();
        }
    });
    form.on('progress', function(bytesReceived, bytesExpected) {
        var percent_complete = (bytesReceived / bytesExpected) * 100;
        console.log(percent_complete.toFixed(2));
    });
    form.on('error', function(err) {
        console.error(err);
    });
});

router.get('/stream', function(req, res) {
	req.socket.setTimeout(30000); // let request last as long as possible
	res.writeHead(200, {"Content-Type":"text/event-stream", "Cache-Control":"no-cache, no-store, must-revalidate", "Connection":"keep-alive"});	
	res.write("retry: 10000\n");
	var messageCount = 0;	  
	eventEmitter.on('labels', function submitLabels(message) {
		console.log('On router message: ' + ' ' + message);
		res.write("event: labels\n");
		res.write('id: ' + messageCount + '\n');
		res.write("data: " + message + '\n\n'); // Note the extra newline
		messageCount++; // Increment our message count
	});
	eventEmitter.on('message', function submitValues(message) {
		console.log('On router message: ' + ' ' + message);
		res.write("event: message\n");
		res.write('id: ' + messageCount + '\n');
		res.write("data: " + message + '\n\n'); // Note the extra newline
		messageCount++; // Increment our message count
	});
	eventEmitter.on('stats', function submitStats(message) {
		res.write("event: stats\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('cameras', function submitCameras(message) {
		res.write("event: cameras\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('failures', function submit_failures(message) {
		res.write("event: failures\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('bins', function submit_bins(message) {
		res.write("event: bins\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('trace', function submit_trace(message) {
		res.write("event: trace\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('fingerprint', function submit_fingerprint(message) {
		res.write("event: fingerprint\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('scenarios', function submit_scenarios(message) {
		res.write("event: scenarios\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('checks', function submitChecks(message) {
		res.write("event: checks\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('summary', function submitSummary(message) {
		res.write("event: summary\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('flow', function submitFlow(message) {
		res.write("event: flow\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('mix', function submitMix(message) {
		res.write("event: mix\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('areas', function submitAreas(message) {
		res.write("event: areas\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('report', function submitReport(message) {
		res.write("event: report\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('series', function submitSeries(message) {
		res.write("event: series\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('stops', function submitStops(message) {
			res.write("event: stops\n");
			res.write("data: " + message + '\n\n');
		});
		eventEmitter.on('control', function submit_control(message) {
		res.write("event: control\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('sites', function submitSites(message) {
		res.write("event: sites\n");
		res.write("data: " + message + '\n\n');
	});
	eventEmitter.on('close', function closeStream() {
		console.log('closeStream: ');
		res.write("event: close\n");
		res.write('id: CLOSE\n');
		res.write("data: CLOSE\n\n"); // Note the extra newline
	});
	req.on("close", function() {
		console.log('Browser closed.');
	});
});

module.exports = router;