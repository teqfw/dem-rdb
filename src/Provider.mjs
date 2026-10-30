// @ts-check
/**
 * @namespace TeqFw_DemRdb_Provider
 * @description DEM repository provider.
 */
export default class Provider {
    /**
 * @param {object} deps
 * @param {any} deps.adapter
 * @param {any} deps.configuration
     */
    constructor({adapter, configuration}) {
        let pending;
        /**
         * @param {any} params
         * @returns {Promise<any>}
         */
        this.get = async function (params) {
            if (!pending) pending = Promise.resolve().then(() => configuration.get()).then(options => adapter.open(options));
            return (await pending).get(params);
        };
    }
}
export const __deps__ = Object.freeze({default:Object.freeze({adapter:'TeqFw_DemRdb_Adapter$',configuration:'TeqFw_DemRdb_Api_Configuration$'})});
