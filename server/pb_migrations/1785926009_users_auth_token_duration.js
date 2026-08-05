/// <reference path="../pb_data/types.d.ts" />
// Belt-and-braces with the clients' refresh-on-open token rotation: a 14-day
// token quietly expiring is what produced SYNC_REVIEW.md finding #10.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("users");
  collection.authToken.duration = 7776000; // 90 days
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("users");
  collection.authToken.duration = 1209600; // PocketBase default, 14 days
  return app.save(collection);
});
