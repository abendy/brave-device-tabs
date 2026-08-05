/// <reference path="../pb_data/types.d.ts" />
const BROWSER_GROUPS_RECORD_ID = "browsergroups01";

migrate((app) => {
  const collection = app.findCollectionByNameOrId("browser_groups");
  const records = app.findRecordsByFilter(collection, "", "-updated", 0, 0);
  const fixedRecord = records.find((record) => record.id === BROWSER_GROUPS_RECORD_ID);

  if (fixedRecord) {
    for (const record of records) {
      if (record.id !== BROWSER_GROUPS_RECORD_ID) {
        app.delete(record);
      }
    }
    return;
  }

  const canonicalRecord = new Record(collection);
  canonicalRecord.id = BROWSER_GROUPS_RECORD_ID;
  canonicalRecord.set("groups", records[0]?.get("groups") ?? []);
  app.save(canonicalRecord);

  for (const record of records) {
    app.delete(record);
  }
}, (app) => {
  // Duplicate deletion cannot be reversed, so the down migration is intentionally a no-op.
});
