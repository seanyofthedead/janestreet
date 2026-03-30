(* Validated stock symbol type *)
type t = string
let create s =
  let s = String.uppercase_ascii s in
  if String.length s >= 1 && String.length s <= 5 then Ok s
  else Error ("Invalid symbol: " ^ s)
let to_string t = t
let equal a b = String.equal a b
let compare = String.compare
