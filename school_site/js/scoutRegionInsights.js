function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function summarizeRegions(athletes = []) {
  const regionsByKey = new Map();

  for (const athlete of athletes) {
    const region = athlete?.region;
    if (!region?.key) continue;

    const existing = regionsByKey.get(region.key) || {
      key: region.key,
      district: region.district || "Unknown District",
      area: region.area || "Unknown Area",
      athleteCount: 0,
      ratingTotal: 0,
      latTotal: 0,
      lngTotal: 0,
      coordCount: 0,
      topAthletes: [],
    };

    existing.athleteCount += 1;
    existing.ratingTotal += safeNumber(athlete.performanceRating);

    if (Number.isFinite(athlete?.coordinates?.lat) && Number.isFinite(athlete?.coordinates?.lng)) {
      existing.latTotal += athlete.coordinates.lat;
      existing.lngTotal += athlete.coordinates.lng;
      existing.coordCount += 1;
    }

    existing.topAthletes.push({
      userId: athlete.userId,
      name: athlete.name,
      performanceRating: safeNumber(athlete.performanceRating),
      sport: athlete.primarySportLabel || athlete.position || "Athlete",
    });

    regionsByKey.set(region.key, existing);
  }

  const regions = Array.from(regionsByKey.values()).map((region) => {
    const averagePerformanceRating = region.athleteCount
      ? Number((region.ratingTotal / region.athleteCount).toFixed(1))
      : 0;

    return {
      key: region.key,
      district: region.district,
      area: region.area,
      athleteCount: region.athleteCount,
      averagePerformanceRating,
      center: region.coordCount
        ? {
            lat: Number((region.latTotal / region.coordCount).toFixed(4)),
            lng: Number((region.lngTotal / region.coordCount).toFixed(4)),
          }
        : null,
      topAthletes: region.topAthletes
        .sort((left, right) => right.performanceRating - left.performanceRating)
        .slice(0, 3),
    };
  }).sort((left, right) => {
    if (right.averagePerformanceRating !== left.averagePerformanceRating) {
      return right.averagePerformanceRating - left.averagePerformanceRating;
    }
    return right.athleteCount - left.athleteCount;
  });

  return {
    regions,
    topRegions: regions.slice(0, 4),
  };
}
