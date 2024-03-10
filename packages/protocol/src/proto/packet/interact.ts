import { Uint8, Endianness, VarLong } from "@serenityjs/binaryutils";
import { Proto, Serialize } from "@serenityjs/raknet";

import { InteractActions, Packet } from "../../enums";
import { InteractPosition, Vector3f } from "../data";

import { DataPacket } from "./data-packet";

@Proto(Packet.Interact)
class Interact extends DataPacket {
	@Serialize(Uint8) public action!: InteractActions;
	@Serialize(VarLong) public targetUniqueEntityId!: bigint;
	@Serialize(InteractPosition, Endianness.Big, "action")
	public position!: Vector3f;
}

export { Interact };
