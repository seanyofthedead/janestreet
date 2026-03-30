(* Time as Unix timestamp in milliseconds *)
type t = float
let now () = Js.Date.now ()
let of_float f = f
let to_float t = t
let diff a b = a -. b
let add_seconds t s = t +. (s *. 1000.0)
let add_minutes t m = add_seconds t (m *. 60.0)

(* Market hours: 9:30 AM - 4:00 PM ET *)
let market_open_hour = 9
let market_open_min = 30
let market_close_hour = 16
let market_close_min = 0

(* Check if timestamp is during market hours (simplified - uses UTC offset) *)
let is_market_hours _t = true (* TODO: implement with proper timezone *)

(* 3:50 PM ET - market making unwind time *)
let is_unwind_time _t = false (* TODO *)

(* 3:55 PM ET - cancel unfilled orders *)
let is_cancel_time _t = false (* TODO *)
