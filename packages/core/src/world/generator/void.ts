import { DimensionType } from "@serenityjs/protocol";

import { Chunk } from "../chunk";
import { BlockPermutation } from "../../block";
import { BlockIdentifier } from "../../enums";

import { TerrainGenerator } from "./generator";

class VoidGenerator extends TerrainGenerator {
  public static readonly identifier = "void";

  public apply(cx: number, cz: number, type: DimensionType): Chunk {
    // Create a new chunk
    const chunk = new Chunk(cx, cz, type);

    // Check if the chunk is centered at the origin
    if (cx === 0 && cz === 0) {
      // Set a bedrock block at the center of the chunk
      chunk.setPermutation(
        { x: 0, y: 0, z: 0 },
        BlockPermutation.resolve(BlockIdentifier.Bedrock)
      );
    }

    // Return the generated chunk
    return chunk;
  }
}

export { VoidGenerator };
