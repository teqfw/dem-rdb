// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Config
 * @description Builds immutable named Knex configurations from the shared CFG snapshot.
 */
export default class Config {
    /**
     * @param {object} deps
     * @param {any} deps.reader
     */
    constructor({reader}) {
        const cache = new Map();
        const namespace = 'TEQFW_DEM_RDB';
        /** @param {any} value @returns {any} */
        const freeze = value => {
            if (value && typeof value === 'object' && !Object.isFrozen(value)) {
                for (const child of Object.values(value)) freeze(child);
                Object.freeze(value);
            }
            return value;
        };
        /** @param {unknown} value @param {string} key @returns {any} */
        const object = (value, key) => {
            let result = value;
            if (typeof result === 'string') {
                try { result = JSON.parse(result); }
                catch { throw new TypeError(`${namespace}__${key} must contain valid JSON.`); }
            }
            if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError(`${namespace}__${key} must be an object.`);
            return result;
        };
        /** @param {unknown} value @param {string} key @returns {any} */
        const boolean = (value, key) => {
            if (value === undefined) return undefined;
            if (typeof value === 'boolean') return value;
            if (value === 0 || value === 1) return value === 1;
            if (typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (['1', 'true', 'yes'].includes(normalized)) return true;
                if (['0', 'false', 'no'].includes(normalized)) return false;
            }
            throw new TypeError(`${namespace}__${key} must be a boolean value.`);
        };
        /** @param {unknown} value @param {string} key @returns {any} */
        const port = (value, key) => {
            if (value === undefined) return undefined;
            if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError(`${namespace}__${key} must be an integer from 1 to 65535.`);
            const result = typeof value === 'number' ? value : Number(value);
            if (!Number.isInteger(result) || result < 1 || result > 65535) throw new TypeError(`${namespace}__${key} must be an integer from 1 to 65535.`);
            return result;
        };
        /** @param {unknown} value @param {string} key @returns {any} */
        const searchPath = (value, key) => {
            if (value === undefined) return undefined;
            const result = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(item => item.trim()) : null;
            if (!result || !result.length || !result.every(item => typeof item === 'string' && item.length > 0)) throw new TypeError(`${namespace}__${key} must be a nonempty string array or comma-separated list.`);
            return result;
        };
        /** @param {unknown} name @returns {string} */
        const normalize = name => {
            if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/i.test(name)) throw new TypeError('A connection name must contain alphanumeric segments separated by hyphens or underscores.');
            if (name.toLowerCase() === 'default') return 'default';
            return name.replaceAll('-', '_').toLowerCase();
        };
        /** @param {string} name @param {string} field @returns {string} */
        const key = (name, field) => `${name === 'default' ? '' : `${name.toUpperCase()}_`}${field}`;

        /** @param {string} [name] @returns {Readonly<Record<string, any>>} */
        this.get = (name = 'default') => {
            name = normalize(name);
            if (cache.has(name)) return cache.get(name);
            const raw = reader.get(namespace);
            const extraKey = key(name, 'EXTRA');
            const extra = raw[extraKey] === undefined ? {} : object(raw[extraKey], extraKey);
            const result = {...extra};
            const connection = extra.connection === undefined ? {} : {...object(extra.connection, extraKey)};
            const fields = {
                database: raw[key(name, 'DATABASE')], filename: raw[key(name, 'FILENAME')], host: raw[key(name, 'HOST')],
                password: raw[key(name, 'PASSWORD')], port: port(raw[key(name, 'PORT')], key(name, 'PORT')),
                socketPath: raw[key(name, 'SOCKET_PATH')], user: raw[key(name, 'USER')],
            };
            for (const [field, value] of Object.entries(fields)) if (value !== undefined) connection[field] = value;
            if (Object.keys(connection).length) result.connection = connection;
            else delete result.connection;
            if (raw[key(name, 'CLIENT')] !== undefined) result.client = String(raw[key(name, 'CLIENT')]);
            const useNullAsDefault = boolean(raw[key(name, 'USE_NULL_AS_DEFAULT')], key(name, 'USE_NULL_AS_DEFAULT'));
            if (useNullAsDefault !== undefined) result.useNullAsDefault = useNullAsDefault;
            const paths = searchPath(raw[key(name, 'SEARCH_PATH')], key(name, 'SEARCH_PATH'));
            if (paths !== undefined) result.searchPath = paths;
            if (raw[key(name, 'VERSION')] !== undefined) result.version = String(raw[key(name, 'VERSION')]);
            const complete = freeze(result);
            cache.set(name, complete);
            return complete;
        };
    }
}
export const __deps__ = Object.freeze({default: Object.freeze({reader: 'TeqFw_Cfg_Reader$'})});
