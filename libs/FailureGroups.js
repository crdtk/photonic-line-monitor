// Groups the failed readings (no fiducial found) by camera and image set, with
// the first and last time each group failed. A group on one camera across
// several image sets points at the camera. A group on one image set across
// cameras points at the part.

function groupFailures(readings) {
	var groups = {};
	readings.forEach(function(r, i) {
		if (!r.failed) return;
		var key = r.camera + '|' + r.image;
		var g = groups[key] || (groups[key] = { camera: r.camera, image: r.image, failed: 0, first: r.time, last: r.time, indexes: [] });
		g.failed++;
		g.last = r.time;
		g.indexes.push(i);
	});
	return Object.keys(groups).sort().map(function(k) { return groups[k]; });
}

module.exports = { groupFailures: groupFailures };
