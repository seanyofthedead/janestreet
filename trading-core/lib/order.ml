type cancel_reason =
  | User_requested
  | Risk_violation
  | End_of_day
  | System_shutdown

type reject_reason =
  | Insufficient_buying_power
  | Invalid_quantity
  | Symbol_not_tradable
  | Risk_check_failed of string
  | Exchange_rejected of string

type order_type = Limit | Market

type time_in_force = Day | Gtc | Ioc

type t = {
  id: string;
  client_order_id: string;
  symbol: Symbol.t;
  side: Types.side;
  qty: float;
  notional: float option;
  order_type: order_type;
  limit_price: Price.t option;
  time_in_force: time_in_force;
  strategy_id: Types.strategy_id;
  submitted_at: Time_utils.t;
}

type status =
  | Pending of { submitted_at: Time_utils.t }
  | Acknowledged of { exchange_id: string; acked_at: Time_utils.t }
  | Partially_filled of { filled_qty: float; remaining: float; avg_price: Price.t }
  | Filled of { filled_qty: float; avg_price: Price.t; filled_at: Time_utils.t }
  | Cancelled of { reason: cancel_reason; cancelled_at: Time_utils.t }
  | Rejected of { reason: reject_reason }

type event =
  | Ack of { exchange_id: string; timestamp: Time_utils.t }
  | Partial_fill of { qty: float; price: Price.t }
  | Fill of { qty: float; price: Price.t; timestamp: Time_utils.t }
  | Cancel of { reason: cancel_reason; timestamp: Time_utils.t }
  | Reject of { reason: reject_reason }

(* State machine: apply event to current status *)
let apply_event (status : status) (event : event) : (status, string) result =
  match status, event with
  | Pending _, Ack { exchange_id; timestamp } ->
    Ok (Acknowledged { exchange_id; acked_at = timestamp })
  | Pending _, Reject { reason } ->
    Ok (Rejected { reason })
  | Pending _, Cancel { reason; timestamp } ->
    Ok (Cancelled { reason; cancelled_at = timestamp })
  | Acknowledged _, Partial_fill { qty; price } ->
    Ok (Partially_filled { filled_qty = qty; remaining = 0.0; avg_price = price })
  | Acknowledged _, Fill { qty; price; timestamp } ->
    Ok (Filled { filled_qty = qty; avg_price = price; filled_at = timestamp })
  | Acknowledged _, Cancel { reason; timestamp } ->
    Ok (Cancelled { reason; cancelled_at = timestamp })
  | Partially_filled { filled_qty; _ }, Partial_fill { qty; price } ->
    Ok (Partially_filled { filled_qty = filled_qty +. qty; remaining = 0.0; avg_price = price })
  | Partially_filled { filled_qty; _ }, Fill { qty; price; timestamp } ->
    Ok (Filled { filled_qty = filled_qty +. qty; avg_price = price; filled_at = timestamp })
  | Partially_filled _, Cancel { reason; timestamp } ->
    Ok (Cancelled { reason; cancelled_at = timestamp })
  | Filled _, _ -> Error "Cannot transition from Filled state"
  | Cancelled _, _ -> Error "Cannot transition from Cancelled state"
  | Rejected _, _ -> Error "Cannot transition from Rejected state"
  | _, _ -> Error "Invalid state transition"

(* Generate client_order_id *)
let make_client_order_id strategy symbol =
  let strategy_str = match strategy with
    | Types.Mean_reversion -> "meanrev"
    | Sector_rotation -> "secrot"
    | Calendar_seasonal -> "calendar"
    | Momentum -> "momentum"
    | Market_making -> "mm"
  in
  let ts = Time_utils.now () in
  let nonce = Js.Math.random () *. 10000.0 |> int_of_float in
  Printf.sprintf "%s_%s_%.0f_%04x" strategy_str (Symbol.to_string symbol) ts nonce

let is_terminal status =
  match status with
  | Filled _ | Cancelled _ | Rejected _ -> true
  | _ -> false
