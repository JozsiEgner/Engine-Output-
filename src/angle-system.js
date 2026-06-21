/**
 * Szöglogika – fő irányok és köztes állapotok
 * KULCS-02 / KULCS-03
 */

const MAIN_DIRECTIONS = [0, 90, 180, 270];

const DIRECTION_LABELS = {
  0:   { hu: 'Észak', en: 'North', key: 'north' },
  90:  { hu: 'Kelet', en: 'East',  key: 'east'  },
  180: { hu: 'Dél',   en: 'South', key: 'south' },
  270: { hu: 'Nyugat',en: 'West',  key: 'west'  }
};

function normalizeAngle(angle) {
  const mod = angle % 360;
  return mod < 0 ? mod + 360 : mod;
}

function isMainDirection(angle) {
  return MAIN_DIRECTIONS.includes(normalizeAngle(angle));
}

function getClosestMainDirection(angle) {
  const normalized = normalizeAngle(angle);
  return MAIN_DIRECTIONS.reduce((closest, dir) => {
    const diff   = Math.min(Math.abs(normalized - dir),   360 - Math.abs(normalized - dir));
    const cdiff  = Math.min(Math.abs(normalized - closest), 360 - Math.abs(normalized - closest));
    return diff < cdiff ? dir : closest;
  });
}

function getMainDirectionLabel(angle, lang = 'hu') {
  const dir = DIRECTION_LABELS[normalizeAngle(angle)];
  return dir ? dir[lang] : 'Köztes';
}

function getMainDirectionKey(angle) {
  const dir = DIRECTION_LABELS[normalizeAngle(angle)];
  return dir ? dir.key : null;
}

export {
  MAIN_DIRECTIONS, DIRECTION_LABELS,
  normalizeAngle, isMainDirection,
  getClosestMainDirection, getMainDirectionLabel, getMainDirectionKey
};
