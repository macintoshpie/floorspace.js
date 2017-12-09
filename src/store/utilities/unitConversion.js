import _ from 'lodash';
import schema from '../../../schema/geometry_schema.json';
import { libraryTypes } from '../modules/application/appconfig';
import deepFreeze from '../../utilities/deepFreeze';

const readUnits = (definition) => {
  if (_.has(definition, 'si_units')) {
    return _.pick(definition, ['si_units', 'ip_units']);
  }
  if (definition.type === 'object') {
    const res = _.pickBy(
      _.mapValues(definition.properties, readUnits),
      _.identity);
    if (_.isEmpty(res)) {
      return null;
    }
    return res;
  }
  if (definition.type === 'array' && _.get(definition, 'items.$ref')) {
    return {
      arrayOf: definition.items.$ref.replace('#/definitions/', ''),
    };
  }
  if (definition.$ref) {
    return {
      $ref: definition.$ref.replace('#/definitions/', ''),
    };
  }
  return null;
};

const rawUnits = {
  $schema: _.pickBy(_.mapValues(schema.properties, readUnits), _.identity),
  ..._.pickBy(
    _.mapValues(schema.definitions, readUnits),
    _.identity),
};

rawUnits.$state = _.pickBy({
  application: rawUnits.Application,
  project: rawUnits.Project,
  geometry: { arrayOf: 'Geometry' },
  models: {
    stories: { arrayOf: 'Story' },
    library: _.fromPairs(
      libraryTypes.map(lt => [lt, rawUnits.$schema[lt]])),
  },
}, _.identity);

export const units = deepFreeze(rawUnits);

const factorTable = {
  'm -> ft': 3.28084,
  'ft -> m': 0.3048,
  'fc -> lux': 10.7639,
  'lux -> fc': 0.092903,
};
export const conversionFactor = (fromUnits, toUnits) => {
  const factor = factorTable[`${fromUnits} -> ${toUnits}`];
  if (!factor) {
    throw new Error(
      `Unable to find conversion from ${fromUnits} to ${toUnits}`);
  }
  return factor;
};

export const getConverter = (path, fromSystem, toSystem) => {
  // this because we don't have a type system
  if (!_.includes(['si_units', 'ip_units'], fromSystem)) {
    throw new Error(`expected fromSystem to be 'si_units' or 'ip_units'. received ${fromSystem}`);
  }
  if (!_.includes(['si_units', 'ip_units'], toSystem)) {
    throw new Error(`expected toSystem to be 'si_units' or 'ip_units'. received ${toSystem}`);
  }

  if (fromSystem === toSystem) { return _.identity; }

  const pathUnits = _.get(units, path);
  if (
    !pathUnits ||
    _.has(pathUnits, 'si_units') && pathUnits.si_units === pathUnits.ip_units
  ) {
    return _.identity;
  }
  if (_.has(pathUnits, 'si_units')) {
    const factor = conversionFactor(pathUnits[fromSystem], pathUnits[toSystem]);
    return val => val * factor;
  }
  if (pathUnits.$ref) {
    return getConverter(pathUnits.$ref, fromSystem, toSystem);
  }
  if (pathUnits.arrayOf) {
    const converter = getConverter(pathUnits.arrayOf, fromSystem, toSystem);
    return arr => arr.map(converter);
  }
  if (_.isObject(pathUnits)) {
    const converters = _.mapValues(
      pathUnits,
      (val, key) => getConverter(`${path}.${key}`, fromSystem, toSystem));
    return obj => _.mapValues(obj, (val, key) => (converters[key] || _.identity)(val));
  }
  throw new Error(`Path ${path} did not lead to a useful spot in 'units'`);
};

export const convertSchema = (data, fromSystem, toSystem) =>
  getConverter('$schema', fromSystem, toSystem)(data);

export const convertState = (data, fromSystem, toSystem) =>
  getConverter('$state', fromSystem, toSystem)(data);

// a library is just a version of schema with fewer keys.
export const convertLibrary = convertSchema;
