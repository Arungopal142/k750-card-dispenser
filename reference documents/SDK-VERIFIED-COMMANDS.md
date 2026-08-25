# Command bytes verified against the vendor Android SDK

Source: `k7x0_dll.jar` (class `k7x0.k7x0`), from
`k7x0_android(lumous-Eng)20251107`. Disassembled with `javap -c -p`.
Both JARs are committed alongside this file.

## Framing — `k7x0.sendAndrecv()`

```
buf[0]    = 0x02 STX
buf[1]    = addr >= 10 ? '1' : '0'
buf[2]    = '0' + addr % 10
buf[3..4] = SELEN = dataLen + 2        (big-endian; CM + PM + extra data)
buf[5]    = CM
buf[6]    = PM
buf[7..]  = data (dataLen bytes)
          = 0x03 ETX
          = XOR of every byte up to and including ETX
```

`lib/k750-protocol.ts` `buildPacket()` derives SELEN from the payload length,
which is the same result.

**The protocol PDF's TypeA section is wrong.** It prints `SELEN 0x03` against
two-byte payloads (and `0x07` for UL close-down). Every detect/activate call in
the JAR passes `dataLen = 0`, so SELEN is 2. The bare two-byte form is correct.

## Response parsing

```
recv[5]      'P' (0x50) success, else error
recv[6]      CM  — the SDK returns -1 if it does not match the CM it sent
recv[7]      PM
recv[8..]    data on success; on error recv[8] IS the return code
data length  respLen - 10
```

FC* commands are the exception: data starts at `recv[9]` (`respLen - 11`), and
FR at `recv[7]` (`respLen - 9`).

## Verified CM/PM pairs

| SDK function | CM | PM | dataLen | Our builder |
|---|---|---|---|---|
| `K7X0_S50DetectCard` | 0x3B | 0x30 | 0 | `buildNfcSearchPacket("S50")` |
| `K7X0_S50GetCardID` | 0x3B | 0x31 | 0 | `buildNfcSerialPacket("S50")` |
| `K7X0_S50LoadSecKey` | 0x3B | 0x32 | 8 | `buildNfcAuthPacket("S50", …)` |
| `K7X0_S50ReadBlock` | 0x3B | 0x33 | 0 | `buildNfcReadBlockPacket("S50", …)` |
| `K7X0_S50Halt` | 0x3B | 0x38 | 0 | `buildNfcHaltPacket("S50")` |
| `K7X0_S70DetectCard` | 0x3C | 0x30 | 0 | `buildNfcSearchPacket("S70")` |
| `K7X0_S70GetCardID` | 0x3C | 0x31 | 0 | `buildNfcSerialPacket("S70")` |
| `K7X0_S70Halt` | 0x3C | 0x38 | 0 | `buildNfcHaltPacket("S70")` |
| `K7X0_ULDetectCard` | 0x3D | 0x30 | 0 | `buildNfcSearchPacket("UL")` |
| `K7X0_ULGetCardID` | 0x3D | 0x31 | 0 | `buildNfcSerialPacket("UL")` |
| `K7X0_ULReadBlock` | 0x3D | 0x32 | 0 | `buildNfcReadBlockPacket("UL", …)` |
| `K7X0_ULHalt` | 0x3D | 0x34 | 0 | `buildNfcHaltPacket("UL")` |
| `K7X0_CPUCardPowerOn` | 0x47 | 0x30 | **0** | `buildNfcSearchPacket("TypeA")` |
| `K7X0_15693GetUid` | 0x48 | 0x30 | 0 | `buildNfcSearchPacket("ISO15693")` |

## Timeouts

`check_timeout = 200 ms`, `action_timeout = 1200 ms`. Card operations use
`action_timeout`. Ours is 3000 ms, which is more generous.

## Consequence for TypeA on this unit

Hardware answered `NF 47 30 01` ("command parameter error") to the two-byte
activate. Since that is byte-identical to what the vendor SDK sends, the packet
is not the problem — this unit has no CPU/TypeA module fitted. `nfcSearch()`
now logs that and moves on instead of probing for a parameter byte that does
not exist.
