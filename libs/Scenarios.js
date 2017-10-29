// Input variants: the same parser run on changed copies of a log. The table
// shows which parts of the page would still work for each kind of input.

var S = require('./ScoreStatistics');
var R = require('./Reports');
var Stops = require('./Stops');

var VARIANTS = [
	{ name: 'This log', change: function(t) { return t; } },
	{ name: 'Cut in half', change: function(t) { return t.split(/\r?\n/).slice(0, Math.floor(t.split(/\r?\n/).length / 2)).join('\n'); } },
	{ name: 'No calibration line', change: function(t) { return t.split(/\r?\n/).filter(function(l) { return !/Inner Diameter/.test(l); }).join('\n'); } },
	{ name: 'No boundary tracing lines', change: function(t) { return t.split(/\r?\n/).filter(function(l) { return !/BT: /.test(l); }).join('\n'); } },
	{ name: 'No pass marks', change: function(t) { return t.replace(/Pass: [01]/g, ''); } },
	{ name: 'Part file names without cogP', change: function(t) { return t.replace(/cogP\.VID/g, '.VID'); } }
];

function run(logText, mapCsv) {
	var readings = S.readScores(logText);
	var areas = S.readAreaResults(logText);
	var checks = R.checksList(readings, areas);
	var yieldReport = R.yieldBySet(readings, areas);
	var stops = Stops.findStops(readings).stops;
	var names = R.mappingCheck(mapCsv, readings);
	var verdicts = R.verdictTable(areas);
	var calibration = /Inner Diameter :[\d.]+,Outer Diameter:[\d.]+/.test(logText);
	return {
		results: checks.length,
		yield: yieldReport.overall,
		stops: stops.length,
		names: names.ok,
		verdicts: verdicts.machine.total,
		calibration: calibration
	};
}

// Returns [{ name, cells: [{ label, ok }] }] for the table on the page.
function scenarios(logText, mapCsv) {
	return VARIANTS.map(function(v) {
		var out = run(v.change(logText), mapCsv);
		return {
			name: v.name,
			cells: [
				{ label: out.results + ' results', ok: out.results > 0 },
				{ label: out.yield == null ? 'no yield' : Math.round(out.yield * 100) + '% pass', ok: out.yield != null && out.results > 0 },
				{ label: out.stops + ' stops', ok: out.stops > 0 },
				{ label: out.names ? 'names trusted' : 'names not trusted', ok: out.names },
				{ label: out.verdicts + ' pass marks', ok: out.verdicts > 0 },
				{ label: out.calibration ? 'calibration found' : 'no calibration', ok: out.calibration }
			]
		};
	});
}

module.exports = { scenarios: scenarios, VARIANTS: VARIANTS };
