import { Hono } from "hono";
import { authRoutes } from "./routes/auth.js";
import { buildsRoutes } from "./routes/builds.js";
import { ownedPartsRoutes } from "./routes/owned-parts.js";
import { partsRoutes } from "./routes/parts.js";
import { wishlistRoutes } from "./routes/wishlist.js";

// Composition seule : chaque ressource vit dans son fichier pour que les tâches parallèles ne se marchent pas dessus.
export const app = new Hono()
  .route("/api/auth", authRoutes)
  .route("/api/parts", partsRoutes)
  .route("/api/owned-parts", ownedPartsRoutes)
  .route("/api/builds", buildsRoutes)
  .route("/api/wishlist", wishlistRoutes);

export type AppType = typeof app;
