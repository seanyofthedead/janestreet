type t = float
let of_float f = f
let to_float t = t
let zero = 0.0
let add a b = a +. b
let sub a b = a -. b
let mul_scalar t s = t *. s
let abs t = Float.abs t
let ( > ) a b = Float.compare a b > 0
let ( < ) a b = Float.compare a b < 0
let ( >= ) a b = Float.compare a b >= 0
let min a b = Float.min a b
let max a b = Float.max a b
let negate t = -1.0 *. t
