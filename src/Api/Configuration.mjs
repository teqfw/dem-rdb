// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Api_Configuration
 * @description Host-selected model and runtime options.
 */
export default class Configuration {
    /**
     * @param {object} deps
     * @param {any} deps.errors
     */
    constructor({errors}) {
        /**
         * @returns {Promise<any>}
         */
        this.get = async function () {
            throw errors.create({code:'UNSUPPORTED', message:'No relational configuration selected by the host.'});
        };
    }
}
export const __deps__ = Object.freeze({default:Object.freeze({errors:'TeqFw_Dem_Repository_Error$'})});
