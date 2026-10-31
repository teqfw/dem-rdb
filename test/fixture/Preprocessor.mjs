export default function Preprocessor() {
    return function (id) {
        return ['TeqFw_Dem_Api_RepositoryProvider','TeqFw_Dem_Api_RepositoryBatch'].includes(id.address)
            ? {...id,address:'TeqFw_DemRdb_Provider'} : id;
    };
}
