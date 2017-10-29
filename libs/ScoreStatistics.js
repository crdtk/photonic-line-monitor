// Groups the score readings of a vision log by image set, and summarises
// each group. The image set is the file name of the image the camera loaded,
// as the log writes it on the "Loading VisionData" line.

var Line = require('./Line');

// A reading is failed when its centre is (0.0, 0.0). The camera then found no
// fiducial, so the score says nothing about alignment. The log also writes
// "Fiducial was not found" just before each such reading, and the two agree.
var FAILED_CENTRE = 'Center: (0.0, 0.0)';

// Boundary tracing failure. The line carries no Score field, so it is read
// here as a failed reading with no score.
var BOUNDARY_FAILURE = 'Center: (-1.000, -1.000)';

// Returns [{ image, score, failed }] in log order, one entry per score reading
// and one per boundary tracing failure.
function readScores(logText) {
	var image = '';
	var readings = [];
	logText.split(/\r?\n/).forEach(function(text) {
		var line = new Line(text);
		if (line.hasImageName()) {
			image = line.getImageName().trim();
		}
		if (!line.hasScore() && text.indexOf(BOUNDARY_FAILURE) === -1) {
			return;
		}
		var camera = (text.match(/Camera: (\d+)/) || [null, null])[1];
		var clock = (text.match(/^(\d{1,2}):\s*(\d{1,2}):(\d{2}):(\d{3})/) || []);
		var time = clock.length ? clock.slice(1).map(function(x, i) { return i === 3 ? x : ('0' + x).slice(-2); }).join(':') : '';
		var failed = text.indexOf(FAILED_CENTRE) > -1 || text.indexOf(BOUNDARY_FAILURE) > -1;
		var bin = text.indexOf(BOUNDARY_FAILURE) > -1 ? 'boundary' : (text.indexOf(FAILED_CENTRE) > -1 ? 'no-mark' : null);
		readings.push({ image: image, camera: camera, time: time, score: line.hasScore() ? parseFloat(line.getScore()) : NaN, failed: failed, bin: bin });
	});
	return readings;
}

// Summary per image set over the valid readings: count, mean, standard
// deviation, min and max. Failed readings are counted apart, not averaged.
function summarise(readings) {
	var groups = {};
	var failed = {};
	readings.forEach(function(r) {
		if (r.failed) {
			failed[r.image] = (failed[r.image] || 0) + 1;
			return;
		}
		(groups[r.image] = groups[r.image] || []).push(r.score);
	});
	var images = Object.keys(Object.assign({}, groups, failed)).sort();
	return images.map(function(image) {
		var xs = groups[image] || [];
		var n = xs.length;
		var mean = n ? xs.reduce(function(a, b) { return a + b; }, 0) / n : NaN;
		var variance = n ? xs.reduce(function(a, x) { return a + (x - mean) * (x - mean); }, 0) / n : NaN;
		return {
			image: image,
			count: n,
			failed: failed[image] || 0,
			mean: mean,
			sd: Math.sqrt(variance),
			min: n ? Math.min.apply(null, xs) : NaN,
			max: n ? Math.max.apply(null, xs) : NaN
		};
	});
}

// Summary per camera over the valid readings, with the slope of the score
// against reading order (negative means the scores are drifting down).
function summariseByCamera(readings) {
	var groups = {};
	var failed = {};
	readings.forEach(function(r) {
		if (r.failed) {
			failed[r.camera] = (failed[r.camera] || 0) + 1;
			return;
		}
		(groups[r.camera] = groups[r.camera] || []).push(r.score);
	});
	var cameras = Object.keys(Object.assign({}, groups, failed)).sort();
	return cameras.map(function(camera) {
		var xs = groups[camera] || [];
		var n = xs.length;
		var mean = n ? xs.reduce(function(a, b) { return a + b; }, 0) / n : null;
		var sd = n ? Math.sqrt(xs.reduce(function(a, x) { return a + (x - mean) * (x - mean); }, 0) / n) : null;
		var mx = (n - 1) / 2;
		var num = xs.reduce(function(a, x, i) { return a + (i - mx) * (x - mean); }, 0);
		var den = xs.reduce(function(a, x, i) { return a + (i - mx) * (i - mx); }, 0);
		return {
			camera: camera,
			valid: n,
			failed: failed[camera] || 0,
			mean: mean,
			sd: sd,
			min: n ? Math.min.apply(null, xs) : null,
			max: n ? Math.max.apply(null, xs) : null,
			trend: n >= 2 ? num / den : null
		};
	});
}

// Area results: the result lines that carry an Area value and no Score, one per
// area check. Returns [{ image, camera, time, area, pass }] in log order.
function readAreaResults(logText) {
	var image = '';
	var results = [];
	var bt = null;
	logText.split(/\r?\n/).forEach(function(text) {
		var line = new Line(text);
		if (line.hasImageName()) {
			image = line.getImageName().trim();
		}
		// Boundary tracing lines. A verdict line names the verdict and the tolerance.
		// A plain line gives only the gold value, so its verdict stays unknown (null).
		// Any other BT line clears the reference, so a stale gold is never reused.
		var verdict = text.match(/BT: Area\([^)]*\): (\d+) is (good|[a-z ]+)\. Gold-Area: (\d+), Tol: (\d+)/);
		var plain = text.match(/BT: Area: (\d+), Gold-Area: (\d+)\./);
		if (verdict) {
			bt = { area: parseInt(verdict[1], 10), good: verdict[2] === 'good', gold: parseInt(verdict[3], 10), tol: parseInt(verdict[4], 10) };
		} else if (plain) {
			bt = { area: parseInt(plain[1], 10), good: null, gold: parseInt(plain[2], 10), tol: null };
		} else if (text.indexOf('BT: ') > -1) {
			bt = null;
		}
		if (line.hasScore()) return;
		var m = text.match(/Map: \d+, Camera: (\d+), Center: \([^)]*\).*Area: (\d+), Pass: ([01])/);
		if (!m) return;
		var clock = (text.match(/^(\d{1,2}):\s*(\d{1,2}):(\d{2}):(\d{3})/) || []);
		var time = clock.length ? clock.slice(1).map(function(x, i) { return i === 3 ? x : ('0' + x).slice(-2); }).join(':') : '';
		results.push({ image: image, camera: m[1], time: time, area: parseInt(m[2], 10), pass: m[3] === '1', gold: bt ? bt.gold : null, tol: bt ? bt.tol : null, good: bt ? bt.good : null });
	});
	return results;
}

module.exports = { readScores: readScores, summarise: summarise, summariseByCamera: summariseByCamera, readAreaResults: readAreaResults };
