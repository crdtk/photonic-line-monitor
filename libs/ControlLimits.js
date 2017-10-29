// Control limits for drift. The first `baseline` valid readings of each camera
// set the centre (their mean) and the spread (their standard deviation). A
// reading outside centre plus or minus `k` times the spread is flagged. The
// baseline is assumed to be in control, so check the first run before you
// trust the limits. Failed readings are never used.

function controlLimits(readings, options) {
	var baseline = (options && options.baseline) || 10;
	var k = (options && options.k) || 3;
	var byCamera = {};
	readings.forEach(function(r, i) {
		if (r.failed) return;
		(byCamera[r.camera] = byCamera[r.camera] || []).push({ index: i, image: r.image, time: r.time, score: r.score });
	});
	return Object.keys(byCamera).sort().map(function(camera) {
		var rows = byCamera[camera];
		var base = rows.slice(0, baseline).map(function(x) { return x.score; });
		var n = base.length;
		var centre = n ? base.reduce(function(a, b) { return a + b; }, 0) / n : null;
		var sd = n ? Math.sqrt(base.reduce(function(a, x) { return a + (x - centre) * (x - centre); }, 0) / n) : null;
		var upper = centre == null ? null : centre + k * sd;
		var lower = centre == null ? null : centre - k * sd;
		var out = rows.filter(function(x) { return upper != null && (x.score > upper || x.score < lower); });
		return { camera: camera, baseline: n, centre: centre, sd: sd, lower: lower, upper: upper, outside: out };
	});
}

module.exports = { controlLimits: controlLimits };
