import { Bool, Uint8, ZigZag } from "@serenityjs/binaryutils";
import { Proto, Serialize } from "@serenityjs/raknet";

import { Packet } from "../../enums";

import { DataPacket } from "./data-packet";

@Proto(Packet.BlockPickRequest)
class BlockPickRequest extends DataPacket {
	@Serialize(ZigZag) public x!: number;
	@Serialize(ZigZag) public y!: number;
	@Serialize(ZigZag) public z!: number;
	@Serialize(Bool) public addData!: boolean;
	@Serialize(Uint8) public selectedSlot!: number;
}

export { BlockPickRequest };
