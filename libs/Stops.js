// Finds stops on the line. The machine measures each image set once per cycle,
// so the gap between two readings of the same image set is one cycle. A stop is
// a gap much longer than the usual cycle, the median of all such gaps. The rule
// therefore adapts to the speed of the machine.

var DEFAULT_FACTOR = 2;

function toSeconds(time) {
	var p = time.split(':').map(Number);
	return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / 1000;
}

function median(xs) {
	var s = xs.slice().sort(function(a, b) { return a - b; });
	var m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Returns { cycle, threshold, stops } where stops is [{ image, from, to, seconds }]
// in log order, for gaps of at least factor times the median cycle.
function findStops(readings, factor) {
	var last = {};
	var gaps = [];
	readings.forEach(function(r) {
		if (!r.time) return;
		if (last[r.image]) {
			gaps.push({ image: r.image, from: last[r.image], to: r.time,
				seconds: toSeconds(r.time) - toSeconds(last[r.image]) });
		}
		last[r.image] = r.time;
	});
	if (!gaps.length) return { cycle: NaN, threshold: NaN, stops: [] };
	var cycle = median(gaps.map(function(g) { return g.seconds; }));
	var threshold = cycle * (factor || DEFAULT_FACTOR);
	return {
		cycle: cycle,
		threshold: threshold,
		stops: gaps.filter(function(g) { return g.seconds >= threshold; })
	};
}

// The site charts plot time as milliseconds on today's date, the same way the
// Line type reads a log line. The failure chart uses that scale too, so the two
// charts share one x axis.
function clockToMs(time) {
	var p = time.split(':').map(Number);
	var d = new Date();
	d.setHours(p[0]);
	d.setMinutes(p[1]);
	d.setSeconds(p[2]);
	d.setMilliseconds(p[3]);
	return d.getTime();
}

// A failure run: two or more failed readings of one image set in a row, with no
// valid reading of that image set between them. Returns [{ image, from, to, count }]
// in log order. The run says the part never passed, not that the machine stopped.
function failureRuns(readings) {
	var open = {};
	var runs = [];
	readings.forEach(function(r) {
		if (!r.time) return;
		var run = open[r.image];
		if (r.failed) {
			if (!run) run = open[r.image] = { image: r.image, from: r.time, to: r.time, count: 0 };
			run.to = r.time;
			run.count++;
		} else if (run) {
			if (run.count >= 2) runs.push(run);
			delete open[r.image];
		}
	});
	Object.keys(open).forEach(function(k) { if (open[k].count >= 2) runs.push(open[k]); });
	return runs.sort(function(x, y) { return clockToMs(x.from) - clockToMs(y.from); });
}

// Chart data: [ms, failed checks so far, area passes so far] per event, and the stops as [from, to] in ms.
function failureSeries(readings, areas) {
	var events = [];
	readings.forEach(function(r) {
		if (r.time) events.push({ ms: clockToMs(r.time), failed: !!r.failed, pass: false });
	});
	(areas || []).forEach(function(r) {
		if (r.time) events.push({ ms: clockToMs(r.time), failed: false, pass: !!r.pass });
	});
	events.sort(function(x, y) { return x.ms - y.ms; });
	var failed = 0, passed = 0;
	var rows = events.map(function(e) {
		if (e.failed) failed++;
		if (e.pass) passed++;
		return [e.ms, failed, passed];
	});
	var stops = findStops(readings).stops.map(function(s) {
		return [clockToMs(s.from), clockToMs(s.to)];
	});
	var runs = failureRuns(readings).map(function(r) {
		return [clockToMs(r.from), clockToMs(r.to), r.image];
	});
	return { rows: rows, stops: stops, runs: runs };
}

module.exports = { findStops: findStops, toSeconds: toSeconds, clockToMs: clockToMs, failureRuns: failureRuns, failureSeries: failureSeries };
