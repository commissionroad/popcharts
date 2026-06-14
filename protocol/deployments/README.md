# Protocol Deployments

`protocol.json` is the protocol-owned registry that feeds the generated public
contract metadata in `src/generated/pregrad-manager.ts`.

Each network entry keeps a stable chain id and a `contracts` object. When
`PregradManager` is deployed for a network, add:

```json
{
  "PregradManager": {
    "address": "0x0000000000000000000000000000000000000000",
    "deployBlock": "0"
  }
}
```

Use a decimal string for `deployBlock` so the generator can emit a bigint
literal without losing precision. Omit `deployBlock` if the deployment block is
not known.
