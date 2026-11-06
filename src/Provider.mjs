// @ts-check
/**
 * @namespace TeqFw_Dem_RDb_Provider
 * @description Host-selected repository and atomic batch provider.
 */
export default class Provider {
    /**
     * @param {object} deps
     * @param {any} deps.adapter
     * @param {any} deps.configuration
     * @param {any} deps.connection
     * @param {any} deps.errors
     */
    constructor({adapter,configuration,connection,errors}) {
        let pending,closePromise,closed=false;
        /** @returns {Promise<any>} */
        const backend=async function () {
            if (closed) throw errors.create({code:'STORAGE',message:'Provider is closed.'});
            if (!pending) pending=Promise.resolve().then(()=>configuration.get()).then(options=>adapter.open({...options,connection}));
            return pending;
        };
        /** @param {any} params @returns {Promise<any>} */
        this.get=async function (params) {return (await backend()).get(params);};
        /** @param {any} params @returns {Promise<any>} */
        this.execute=async function (params) {return (await backend()).execute(params);};
        /** @returns {Promise<void>} */
        this.close=function () {
            if (closePromise) return closePromise;
            closed=true;
            closePromise=pending ? pending.then(backend=>backend.close()) : Promise.resolve();
            return closePromise;
        };
    }
}
export const __deps__=Object.freeze({default:Object.freeze({adapter:'TeqFw_Dem_RDb_Adapter$',configuration:'TeqFw_Dem_RDb_Api_Configuration$',connection:'TeqFw_Dem_RDb_Connection$',errors:'TeqFw_Dem_Repository_Error$'})});
