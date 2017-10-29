// Yield and utilisation from the measured results only.
// An image set stands in for a lot: the log carries no lot identifier.
// A result is one score reading or one area check. Unmeasured parts are not
// counted in the yield, because the log cannot show them.

var Stops = require('./Stops');

function setName(image) {
	return (image || '').replace(/cogP\.VID$|\.VID$/, '');
}

// Returns { sets: [{ image, results, passes, fails, yield }], overall }.
function yieldBySet(readings, areas) {
	var sets = {};
	function add(image, pass) {
		var k = setName(image) || '(no image)';
		var s = sets[k] || (sets[k] = { image: k, results: 0, passes: 0, fails: 0 });
		s.results++;
		if (pass) s.passes++; else s.fails++;
	}
	readings.forEach(function(r) { if (!isNaN(r.score)) add(r.image, !r.failed); });
	(areas || []).forEach(function(r) { add(r.image, r.pass); });
	var list = Object.keys(sets).sort().map(function(k) {
		var s = sets[k];
		s.yield = s.results ? s.passes / s.results : null;
		return s;
	});
	var results = list.reduce(function(a, s) { return a + s.results; }, 0);
	var passes = list.reduce(function(a, s) { return a + s.passes; }, 0);
	return { sets: list, overall: results ? passes / results : null, results: results, passes: passes };
}

// Total seconds covered by the stops. One stop shows up once per image set, so
// the intervals overlap, and each second counts once.
function mergedSeconds(stops) {
	var iv = (stops || []).map(function(s) { return [Stops.toSeconds(s.from), Stops.toSeconds(s.to)]; });
	iv.sort(function(x, y) { return x[0] - y[0]; });
	var total = 0, cur = null;
	iv.forEach(function(v) {
		if (!cur || v[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = v.slice(); }
		else if (v[1] > cur[1]) cur[1] = v[1];
	});
	if (cur) total += cur[1] - cur[0];
	return total;
}

// Machine utilisation: the share of the logged span not spent in stops.
// Returns { spanSeconds, stopSeconds, utilisation }.
function utilisation(readings, stops) {
	var timed = readings.filter(function(r) { return r.time; });
	if (timed.length < 2) return { spanSeconds: 0, stopSeconds: 0, utilisation: null };
	var span = Stops.toSeconds(timed[timed.length - 1].time) - Stops.toSeconds(timed[0].time);
	var stopSeconds = mergedSeconds(stops);
	return { spanSeconds: span, stopSeconds: stopSeconds, utilisation: span > 0 ? 1 - stopSeconds / span : null };
}

// Silent steps against the healthy-set baseline. A healthy set is one whose
// yield reaches the threshold. The baseline is the median result count of the
// healthy sets. A set with fewer results than the baseline has silent steps, the
// difference. The count is a shortfall against a baseline, not a proof of a skipped step.
function silentSteps(yieldReport, threshold) {
	var limit = threshold || 0.9;
	var sets = yieldReport.sets.filter(function(s) { return s.image !== "(no image)"; });
	var healthy = sets.filter(function(s) { return s.yield !== null && s.yield >= limit; })
		.map(function(s) { return s.results; }).sort(function(a, b) { return a - b; });
	if (!healthy.length) return { baseline: null, threshold: limit, healthy: 0, total: 0, sets: [] };
	var mid = Math.floor(healthy.length / 2);
	var baseline = healthy.length % 2 ? healthy[mid] : (healthy[mid - 1] + healthy[mid]) / 2;
	var out = sets.map(function(s) {
		return { image: s.image, results: s.results, silent: Math.max(0, baseline - s.results) };
	});
	return {
		baseline: baseline,
		threshold: limit,
		healthy: healthy.length,
		total: out.reduce(function(a, s) { return a + s.silent; }, 0),
		sets: out
	};
}

// Area deviation from the gold reference, one point per area check that carries
// a gold value. deviation = area minus gold. good is the machine verdict.
function areaDeviation(areas) {
	return (areas || []).filter(function(a) { return a.gold != null && a.time; }).map(function(a) {
		return { ms: Stops.clockToMs(a.time), deviation: a.area - a.gold, good: !!a.good, image: setName(a.image) };
	});
}

// Heatmap: one row per image set, one column per time bin. Each cell counts the
// passes and fails of that set in that bin, from score readings and area checks.
function heatmap(readings, areas, binSeconds) {
	var bin = (binSeconds || 300) * 1000;
	var events = [];
	(readings || []).forEach(function(r) { if (r.time && !isNaN(r.score)) events.push({ image: setName(r.image), ms: Stops.clockToMs(r.time), pass: !r.failed }); });
	(areas || []).forEach(function(a) { if (a.time) events.push({ image: setName(a.image), ms: Stops.clockToMs(a.time), pass: !!a.pass }); });
	if (!events.length) return { bins: [], rows: [] };
	var t0 = Math.min.apply(null, events.map(function(e) { return e.ms; }));
	var t1 = Math.max.apply(null, events.map(function(e) { return e.ms; }));
	var n = Math.floor((t1 - t0) / bin) + 1;
	var bins = [];
	for (var i = 0; i < n; i++) bins.push(t0 + i * bin);
	var rows = {};
	events.forEach(function(e) {
		var k = e.image || '(no image)';
		var row = rows[k] || (rows[k] = { image: k, cells: bins.map(function() { return { pass: 0, fail: 0 }; }) });
		var c = row.cells[Math.floor((e.ms - t0) / bin)];
		if (e.pass) c.pass++; else c.fail++;
	});
	return { bins: bins, rows: Object.keys(rows).sort().map(function(k) { return rows[k]; }) };
}

// Instruction mix. The log names three checks by their DONE lines: SNAP (camera
// snap), TRC (boundary trace, gives area) and MAT (pattern match, gives score).
// Each image set gets a count of each check, plus the reuse lines, where the
// machine reads the file it already holds. Periods are summed per check.
var PHASES = ['SNAP', 'TRC', 'MAT'];

function phaseMix(logText) {
	var img = '';
	var sets = {};
	var periods = { SNAP: [], TRC: [], MAT: [] };
	function set(name) {
		var k = name || '(no image)';
		return sets[k] || (sets[k] = { image: k, SNAP: 0, TRC: 0, MAT: 0, reuse: 0 });
	}
	logText.split(/\r?\n/).forEach(function(raw) {
		var t = raw.replace(/\r$/, '');
		if (t.indexOf('Loading VisionData') > -1 && !/cogP\.VID$/.test(t)) {
			img = setName(t.substring(t.lastIndexOf('\\') + 1));
		}
		var d = t.match(/(SNAP|TRC|MAT) DONE - Period: ([0-9.]+)/);
		if (d) {
			set(img)[d[1]]++;
			periods[d[1]].push(parseFloat(d[2]));
		}
		if (t.indexOf('Last File is same as current file') > -1) set(img).reuse++;
	});
	var all = PHASES.reduce(function(a, p) { return a + periods[p].reduce(function(x, y) { return x + y; }, 0); }, 0);
	var phases = {};
	PHASES.forEach(function(p) {
		var xs = periods[p];
		var total = xs.reduce(function(a, b) { return a + b; }, 0);
		var share = all ? total / all : 0;
		phases[p] = { count: xs.length, mean: xs.length ? total / xs.length : null, total: total, share: share,
			halvedSaving: share / 2, halvedSpeedup: 1 / (1 - share / 2) };
	});
	return { sets: Object.keys(sets).sort().map(function(k) { return sets[k]; }), phases: phases };
}

// Attempts per image set: snaps per measured result (TRC plus MAT lines). One snap
// per result is the normal case. A healthy set is one with yield at or above the
// threshold. The baseline is the median ratio of the healthy sets. A set above
// 1.5 times the baseline is flagged.
function attemptsReport(mixSets, yieldSets, threshold) {
	var limit = threshold || 0.9;
	var yieldBy = {};
	(yieldSets || []).forEach(function(s) { yieldBy[s.image] = s; });
	function ratio(m) { var n = m.TRC + m.MAT; return n ? m.SNAP / n : null; }
	var healthy = mixSets.filter(function(m) {
		var y = yieldBy[m.image];
		return m.image !== '(no image)' && y && y.yield !== null && y.yield >= limit && ratio(m) !== null;
	}).map(ratio).sort(function(a, b) { return a - b; });
	var baseline = null;
	if (healthy.length) {
		var mid = Math.floor(healthy.length / 2);
		baseline = healthy.length % 2 ? healthy[mid] : (healthy[mid - 1] + healthy[mid]) / 2;
	}
	return { baseline: baseline, threshold: limit, sets: mixSets.map(function(m) {
		var r = ratio(m);
		return { image: m.image, SNAP: m.SNAP, TRC: m.TRC, MAT: m.MAT, reuse: m.reuse, attempts: r,
			over: baseline !== null && r !== null && r > baseline * 1.5 };
	}) };
}

// Score resolution. Scores print with one decimal place, so one step is 0.1.
// Returns the within-set standard deviation in steps, per image set.
var SCORE_STEP = 0.1;
function resolutionSteps(scoreSets) {
	return scoreSets.map(function(s) {
		return { image: setName(s.image), sd: s.sd, steps: s.sd == null || isNaN(s.sd) ? null : s.sd / SCORE_STEP };
	});
}

// Log funnel: how much of the log each kind of line carries. Each step is a
// count and its share of all lines in the log.
function logFunnel(logText, readings, areas) {
	var lines = logText.split(/\r?\n/).filter(function(l) { return l.length > 0; });
	var resultLines = lines.filter(function(l) { return /Map: \d+, Camera/.test(l); }).length;
	var steps = [
		{ label: 'Lines in the log', count: lines.length },
		{ label: 'Result lines (Map, Camera)', count: resultLines },
		{ label: 'Score readings and boundary failures', count: readings.length },
		{ label: 'Valid scores', count: readings.filter(function(r) { return !r.failed; }).length },
		{ label: 'Area checks (with and without a gold line)', count: areas.length },
		{ label: 'Area passes', count: areas.filter(function(a) { return a.pass; }).length }
	];
	steps.forEach(function(st) { st.share = steps[0].count ? st.count / steps[0].count : 0; });
	return steps;
}

// Flow from image sets to checks to outcomes. Score readings are the MAT check,
// area checks are the TRC check. Silent shortfall comes from the silent-step baseline.
function flowData(readings, areas, silent) {
	var links = {};
	var sets = {};
	function link(a, b, v) { if (!v) return; var k = a + '|' + b; links[k] = links[k] || { source: a, target: b, value: 0 }; links[k].value += v; }
	function setNode(name) { sets[name] = true; return 'set:' + name; }
	readings.forEach(function(r) {
		if (isNaN(r.score)) return;
		var s = setNode(setName(r.image) || '(no image)');
		link(s, 'check:score', 1);
		link('check:score', r.failed ? 'out:fail' : 'out:pass', 1);
	});
	areas.forEach(function(a) {
		var s = setNode(setName(a.image) || '(no image)');
		link(s, 'check:area', 1);
		link('check:area', a.pass ? 'out:pass' : 'out:fail', 1);
	});
	(silent && silent.sets || []).forEach(function(x) {
		if (x.silent > 0) link(setNode(x.image), 'out:silent', x.silent);
	});
	var nodes = [];
	Object.keys(sets).sort().forEach(function(k) { nodes.push({ id: 'set:' + k, label: k, col: 0 }); });
	nodes.push({ id: 'check:score', label: 'Score (MAT check)', col: 1 });
	nodes.push({ id: 'check:area', label: 'Area (TRC check)', col: 1 });
	nodes.push({ id: 'out:pass', label: 'Pass', col: 2 });
	nodes.push({ id: 'out:fail', label: 'Fail', col: 2 });
	nodes.push({ id: 'out:silent', label: 'Silent shortfall', col: 2 });
	return { nodes: nodes, links: Object.keys(links).map(function(k) { return links[k]; }) };
}

// One entry per result line, with its part, pass flag and time in ms.
// Boundary failures are taken once, from the area checks.
function checksList(readings, areas) {
	var out = [];
	(readings || []).forEach(function(r) { if (r.time && !isNaN(r.score)) out.push({ image: setName(r.image), pass: !r.failed, ms: Stops.clockToMs(r.time) }); });
	(areas || []).forEach(function(a) { if (a.time) out.push({ image: setName(a.image), pass: !!a.pass, ms: Stops.clockToMs(a.time) }); });
	return out;
}

// Plain sentences for a reader outside the project. Every number comes from the
// same counts the charts use.
function summaryLines(input) {
	var y = input.yieldReport, u = input.utilisation, stops = input.stops || [];
	var lines = [];
	var pad = function(n) { return (n < 10 ? '0' : '') + n; };
	var clock = function(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
	lines.push('The machine recorded ' + y.results + ' results. ' + y.passes + ' passed, which is ' + Math.round(y.overall * 100) + '%.');
	var failed = y.sets.filter(function(s) { return s.image !== '(no image)' && s.fails > 0; })
		.sort(function(a, b) { return b.fails - a.fails; });
	var totalFails = y.results - y.passes;
	if (totalFails > 0 && failed.length) {
		var top = failed.slice(0, 2);
		var times = [];
		(input.checks || []).forEach(function(c) { if (!c.pass && top.some(function(t) { return t.image === c.image; })) times.push(c.ms); });
		var span = times.length ? ', between ' + clock(Math.min.apply(null, times)) + ' and ' + clock(Math.max.apply(null, times)) : '';
		lines.push(totalFails + ' checks failed. Most failures came from ' + top.map(function(t) { return 'part ' + t.image + ' (' + t.fails + ')'; }).join(' and ') + span + '.');
	} else {
		lines.push('No checks failed.');
	}
	if (u && u.spanSeconds > 0) {
		lines.push('For ' + Math.round((1 - u.utilisation) * 100) + '% of the ' + Math.round(u.spanSeconds / 60) + ' minutes of the run, the machine recorded no results.');
	}
	if (stops.length) {
		var longest = stops.reduce(function(a, s) { return s.seconds > a.seconds ? s : a; }, stops[0]);
		lines.push('The longest wait for one part was ' + Math.round(longest.seconds / 60) + ' minutes, from ' + longest.from.slice(0, 8) + ' to ' + longest.to.slice(0, 8) + '.');
	}
	return lines;
}

// Log check: a short list of gates. Each gate says whether the page can rely on
// one fact about the log, and the next step when it cannot.
function logChecks(logText, readings, areas, mappings) {
	var lines = logText.split(/\r?\n/);
	var calibration = lines.some(function(l) { return /Inner Diameter :[\d.]+,Outer Diameter:[\d.]+/.test(l); });
	// Parts are image sets. A part is named when a mapping key has the same set name.
	var checks = checksList(readings, areas);
	var parts = {};
	checks.forEach(function(c) { if (c.image !== '(no image)') parts[c.image] = true; });
	var mapped = {};
	Object.keys(mappings || {}).forEach(function(k) { mapped[setName(k)] = true; });
	var setCount = Object.keys(parts).length;
	var namedCount = Object.keys(parts).filter(function(p) { return mapped[p]; }).length;
	var dated = lines.some(function(l) { return /\d{4}-\d{2}-\d{2}/.test(l) || /\d{2}\/\d{2}\/\d{4}/.test(l); });
	var verdicts = areas.filter(function(a) { return a.good !== null && a.good !== undefined; }).length;
	var unitsStated = lines.some(function(l) { return /\b(mm|um|µm|micron|pixel|pixels)\b/i.test(l); });
	return [
		{ name: 'Log has result lines', ok: checks.length > 0, detail: checks.length + ' result lines found', next: 'Choose the log file from the machine.' },
		{ name: 'Calibration line found', ok: calibration, detail: calibration ? 'yes' : 'no', next: 'Ask the machine team for a log with the calibration line.' },
		{ name: 'Part names known', ok: namedCount === setCount && setCount > 0, detail: namedCount + ' of ' + setCount + ' parts have a name', next: 'Add the missing parts to filename-mappings.csv, or accept the unnamed rows.' },
		{ name: 'Dates in the log', ok: dated, detail: dated ? 'yes' : 'no, only the time of day', next: 'Ask for an export that carries the date.' },
		{ name: 'Units stated', ok: unitsStated, detail: unitsStated ? 'yes' : 'no', next: 'Ask the machine team for the units of the step times and the area.' },
		{ name: 'Machine pass marks present', ok: verdicts > 0, detail: verdicts + ' area checks carry a machine verdict', next: 'Read the machine pass marks from a log that includes them.' }
	];
}

// Mapping check: does filename-mappings.csv describe this log? For each named
// part, the first score in the mapping file is compared with the first score of
// the same part in the log. Names are trusted only when most of them agree.
function mappingCheck(csvText, readings) {
	var first = {};
	readings.forEach(function(r) { if (!(r.image in first) && !isNaN(r.score)) first[r.image] = r.score; });
	var seen = {}, named = 0, matches = 0;
	csvText.split(/\r?\n/).slice(1).forEach(function(line) {
		var c = line.split(',');
		var file = c[2], score = parseFloat(c[1]), name = (c[4] || '').trim();
		if (!file || !name || seen[file]) return;
		seen[file] = true;
		named++;
		if (file in first && Math.abs(first[file] - score) < 0.05) matches++;
	});
	var ok = named > 0 && matches >= named / 2;
	return { ok: ok, named: named, matches: matches, detail: matches + ' of ' + named + ' named parts show the same first score' };
}

// Verdict agreement: the machine pass mark against two other rules. The first
// rule is the machine verdict on the boundary tracing line. The second is our
// reading of the tolerance: the area is within the tolerance of gold.
function verdictTable(areas) {
	function table(pairs) {
		var t = { passPass: 0, passFail: 0, failPass: 0, failFail: 0 };
		pairs.forEach(function(p) {
			if (p.rule && p.pass) t.passPass++;
			else if (p.rule && !p.pass) t.failPass++;
			else if (!p.rule && p.pass) t.passFail++;
			else t.failFail++;
		});
		var n = pairs.length;
		t.total = n;
		t.agree = n ? (t.passPass + t.failFail) / n : null;
		return t;
	}
	var machine = areas.filter(function(a) { return a.good !== null && a.good !== undefined; })
		.map(function(a) { return { rule: a.good, pass: a.pass }; });
	var tolerance = areas.filter(function(a) { return a.gold != null && a.tol != null; })
		.map(function(a) { return { rule: Math.abs(a.area - a.gold) <= a.tol, pass: a.pass }; });
	return { machine: table(machine), tolerance: table(tolerance) };
}

// Line routes: where each line of the log went. Result lines are split into
// scored readings, area passes and boundary failures. The rest are ignored.
function lineRoutes(logText, readings, areas) {
	var lines = logText.split(/\r?\n/).filter(function(l) { return l.length > 0; });
	var resultLines = lines.filter(function(l) { return /Map: \d+, Camera/.test(l); }).length;
	var scored = readings.filter(function(r) { return !isNaN(r.score); }).length;
	var areaPass = areas.filter(function(a) { return a.pass; }).length;
	var boundary = areas.length - areaPass;
	var total = lines.length;
	return { total: total, routes: [
		{ label: 'Scored readings', count: scored },
		{ label: 'Area passes', count: areaPass },
		{ label: 'Boundary failures', count: boundary },
		{ label: 'Other lines (ignored)', count: total - resultLines }
	], resultLines: resultLines };
}

// Line kinds: each kind of line, counted, with a note on whether the page uses it.
var KINDS = [
	{ name: 'Result line (Map, Camera)', re: /Map: \d+, Camera/, used: 'scores, passes, failures' },
	{ name: 'Part file loaded', re: /Loading VisionData/, used: 'part names' },
	{ name: 'Camera photo done (SNAP)', re: /SNAP DONE/, used: 'step times, repeat photos' },
	{ name: 'Edge check done (TRC)', re: /TRC DONE/, used: 'step times' },
	{ name: 'Pattern check done (MAT)', re: /MAT DONE/, used: 'step times' },
	{ name: 'Boundary tracing line', re: /BT: /, used: 'gold reference, machine verdict' },
	{ name: 'Same file reused', re: /Last File is same as current file/, used: 'reuse count' },
	{ name: 'Calibration line', re: /Inner Diameter/, used: 'log check' }
];

function lineKinds(logText) {
	var lines = logText.split(/\r?\n/).filter(function(l) { return l.length > 0; });
	var known = KINDS.map(function(k) { return { name: k.name, used: k.used, count: 0 }; });
	var other = {};
	lines.forEach(function(l) {
		var hit = KINDS.findIndex(function(k) { return k.re.test(l); });
		if (hit >= 0) { known[hit].count++; return; }
		// Group by the message wording: drop the time, file ids, paths and numbers, keep six words.
		var key = l.replace(/^[0-9:]+\s*/, '')
			.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F-]+/g, '(file id)')
			.replace(/[A-Za-z]:\\\S*/g, '(path)')
			.replace(/[-+]?\d[\d.,]*/g, '#')
			.split(/\s+/).slice(0, 6).join(' ').replace(/[\s:]+$/, '').trim();
		if (!key) key = '(blank)';
		other[key] = (other[key] || 0) + 1;
	});
	var ignored = Object.keys(other).map(function(k) { return { name: k, used: 'not used', count: other[k] }; })
		.sort(function(a, b) { return b.count - a.count; }).slice(0, 8);
	return { total: lines.length, kinds: known.concat(ignored) };
}

// Run fingerprint: facts that let anyone check which file and which code made the page.
function fingerprint(fileBytes, logText, codeVersion) {
	var crypto = require('crypto');
	var hash = crypto.createHash('sha256').update(fileBytes).digest('hex');
	return { bytes: fileBytes.length, sha256: hash, lines: logText.split(/\r?\n/).filter(function(l) { return l.length > 0; }).length, code: codeVersion, processedAt: new Date().toISOString() };
}

// Failure bins: each failed reading sorts into one named bin. A Pareto list puts
// the bins in order of size, with the running share of all failures.
var BIN_NAMES = {
	'boundary': { label: 'Boundary tracing failed', meaning: 'the outline of the part could not be traced' },
	'no-mark': { label: 'No mark found', meaning: 'the camera did not find the reference mark' }
};

function failureBins(readings) {
	var failed = readings.filter(function(r) { return r.failed; });
	var counts = {};
	var parts = {};
	failed.forEach(function(r) {
		var b = r.bin || 'no-mark';
		counts[b] = (counts[b] || 0) + 1;
		parts[b] = parts[b] || {};
		var p = setName(r.image) || '(no image)';
		parts[b][p] = (parts[b][p] || 0) + 1;
	});
	var total = failed.length;
	var sorted = Object.keys(counts).sort(function(x, y) { return counts[y] - counts[x]; });
	var running = 0;
	var pareto = sorted.map(function(b) {
		running += counts[b];
		var topPart = Object.keys(parts[b]).sort(function(x, y) { return parts[b][y] - parts[b][x]; })[0];
		return { bin: b, label: BIN_NAMES[b] ? BIN_NAMES[b].label : b, meaning: BIN_NAMES[b] ? BIN_NAMES[b].meaning : '',
			count: counts[b], share: total ? counts[b] / total : 0, cumulative: total ? running / total : 0,
			parts: Object.keys(parts[b]).length, topPart: topPart };
	});
	return { total: total, bins: pareto };
}

module.exports = { yieldBySet: yieldBySet, utilisation: utilisation, silentSteps: silentSteps, areaDeviation: areaDeviation, heatmap: heatmap, phaseMix: phaseMix, attemptsReport: attemptsReport, resolutionSteps: resolutionSteps, logFunnel: logFunnel, flowData: flowData, summaryLines: summaryLines, checksList: checksList, logChecks: logChecks, mappingCheck: mappingCheck, verdictTable: verdictTable, lineRoutes: lineRoutes, lineKinds: lineKinds, fingerprint: fingerprint, failureBins: failureBins };
