import { connectDB, disconnectDB, Product, User } from "./db.js";

// One-off cleanup: the store no longer allows products without a real photo, so
// remove any legacy products that have no image (they previously rendered as
// generated placeholder art). Run once against the live database:
//   node src/migrate-remove-imageless.js
async function main() {
  await connectDB();

  const imageless = await Product.find({
    $or: [{ image: null }, { image: "" }, { image: { $exists: false } }],
  }).select("_id name");

  if (imageless.length === 0) {
    console.log("No image-less products found — nothing to remove.");
    return;
  }

  const ids = imageless.map((p) => p._id);
  // Keep wishlists consistent by dropping references to the removed products.
  await User.updateMany({}, { $pull: { wishlist: { $in: ids } } });
  const { deletedCount } = await Product.deleteMany({ _id: { $in: ids } });

  console.log(`Removed ${deletedCount} product(s) without images:`);
  imageless.forEach((p) => console.log(`  · ${p.name}`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
