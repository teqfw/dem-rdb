// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Connection
 * @description Owns one Knex client and its pool lifecycle.
 */
export default class Connection {
    /**
     * @param {object} deps
     * @param {any} deps.createRequire
     */
    constructor({createRequire}) {
        let state = 'new';
        let client;
        let initPromise;
        let disconnectPromise;
        /** @param {any} value @returns {any} */
        const clone = value => JSON.parse(JSON.stringify(value));

        /** @param {any} knexConfig @returns {Promise<void>} */
        this.init = async knexConfig => {
            if (state !== 'new') throw new Error('Connection initialization is only valid once.');
            state = 'initializing';
            let config;
            try { config = clone(knexConfig); }
            catch (error) { state = 'failed'; throw error; }
            if (!config || typeof config !== 'object' || typeof config.client !== 'string' || !config.client) {
                state = 'failed';
                throw new TypeError('A nonempty Knex client is required.');
            }
            initPromise = Promise.resolve().then(async () => {
                if (typeof createRequire !== 'function') throw new TypeError('The package-owned Knex resolver is unavailable.');
                const factory = (await import(createRequire(import.meta.url).resolve('knex'))).default;
                return factory(config);
            }).then(value => {
                client = value;
                if (state === 'initializing') state = 'ready';
            }, error => {
                state = 'failed';
                throw error;
            });
            return initPromise;
        };
        /** @returns {any} */
        this.getClient = () => {
            if (state !== 'ready') throw new Error('Connection is not initialized or is shutting down.');
            return client;
        };
        /** @returns {Promise<void>} */
        this.disconnect = () => {
            if (disconnectPromise) return disconnectPromise;
            const prior = state;
            state = 'closing';
            disconnectPromise = (async () => {
                if (prior === 'initializing') {
                    try { await initPromise; } catch { /* Preserve initialization failure as the init result. */ }
                }
                const owned = client;
                client = undefined;
                if (owned) await owned.destroy();
                state = 'closed';
            })();
            return disconnectPromise;
        };
    }
}
export const __deps__ = Object.freeze({default: Object.freeze({createRequire:'node:module__createRequire'})});
