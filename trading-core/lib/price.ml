type t = float
let of_float f = if f >= 0.0 then Ok f else Error "Price must be non-negative"
let to_float t = t
let zero = 0.0
let add a b = a +. b
let sub a b = a -. b
let mul_scalar t s = t *. s
let compare = Float.compare
let ( > ) a b = Float.compare a b > 0
let ( < ) a b = Float.compare a b < 0
let ( >= ) a b = Float.compare a b >= 0
let ( <= ) a b = Float.compare a b <= 0
