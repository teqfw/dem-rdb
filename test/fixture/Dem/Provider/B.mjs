// @ts-check
/** @namespace Test_Dem_Provider_B @description Provider B singleton wrapper. */
export default class ProviderB {
    /** @param {{inner:any}} deps */
    constructor({inner}) { this.get=params=>inner.get(params);this.execute=params=>inner.execute(params);this.close=()=>inner.close(); }
}
export const __deps__=Object.freeze({default:Object.freeze({inner:'TeqFw_Dem_RDb_Provider$$'})});
