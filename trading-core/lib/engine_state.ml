type t = Types.engine_state

type transition =
  | Watchdog_connected
  | Warmup_complete
  | Market_open
  | Market_close
  | Watchdog_lost
  | Data_gap
  | Data_recovered
  | Watchdog_recovered
  | Flatten_triggered of string
  | Kill_triggered of string
  | Cooldown_expired
  | Human_acknowledged
  | Restart

let apply_transition (state : t) (transition : transition) : (t, string) result =
  match state, transition with
  (* Starting transitions *)
  | Starting, Watchdog_connected -> Ok Warming_up

  (* Warming_up transitions *)
  | Warming_up, Warmup_complete -> Ok Trading

  (* Trading transitions *)
  | Trading, Market_close -> Ok Off_hours
  | Trading, Watchdog_lost -> Ok Read_only
  | Trading, Data_gap -> Ok Read_only
  | Trading, Flatten_triggered reason ->
    Ok (Cooldown { until = Time_utils.to_float (Time_utils.add_minutes (Time_utils.now ()) 30.0); reason })
  | Trading, Kill_triggered reason ->
    Ok (Halted { reason })

  (* Off_hours transitions *)
  | Off_hours, Market_open -> Ok Warming_up
  | Off_hours, Kill_triggered reason ->
    Ok (Halted { reason })

  (* Read_only transitions *)
  | Read_only, Watchdog_recovered -> Ok Trading
  | Read_only, Data_recovered -> Ok Trading
  | Read_only, Kill_triggered reason ->
    Ok (Halted { reason })

  (* Cooldown transitions *)
  | Cooldown _, Cooldown_expired -> Ok Warming_up
  | Cooldown _, Kill_triggered reason ->
    Ok (Halted { reason })

  (* Halted transitions *)
  | Halted _, Human_acknowledged -> Ok Starting

  (* Restart from any non-trading state *)
  | _, Restart -> Ok Starting

  | _ -> Error (Printf.sprintf "Invalid transition from current state")

let is_trading_allowed = function
  | Types.Trading -> true
  | _ -> false

let is_data_processing_allowed = function
  | Types.Trading | Read_only | Off_hours | Warming_up -> true
  | _ -> false

let to_string = function
  | Types.Starting -> "Starting"
  | Warming_up -> "Warming_up"
  | Trading -> "Trading"
  | Off_hours -> "Off_hours"
  | Read_only -> "Read_only"
  | Cooldown { reason; _ } -> "Cooldown(" ^ reason ^ ")"
  | Halted { reason } -> "Halted(" ^ reason ^ ")"
