(** Risk engine tests - assert-based, no framework needed. *)

open Trading_core

let now = 1000000000.0  (* arbitrary current time in ms *)

(** Helper: make a basic portfolio *)
let make_portfolio ~equity ~cash ~positions =
  let open Portfolio in
  { positions; cash = Money.of_float cash; equity = Money.of_float equity;
    buying_power = Money.of_float cash; daily_pnl = Money.zero; total_pnl = Money.zero }

(** Helper: make a basic signal *)
let make_signal ?(strategy = Types.Mean_reversion) ?(side = Types.Buy)
    ?(strength = Types.Strong 0.9) ?(max_position_pct = 0.10) symbol_str =
  let symbol = match Symbol.create symbol_str with Ok s -> s | Error _ -> failwith "bad symbol" in
  Signal.{ strategy; symbol; side; strength;
           target_price = 100.0; max_position_pct;
           timestamp = Time_utils.of_float now }

(** Helper: make a basic position *)
let make_position ?(strategy = Types.Mean_reversion) ?(qty = 10.0)
    ?(entry = 100.0) ?(current = 100.0) symbol_str =
  let symbol = match Symbol.create symbol_str with Ok s -> s | Error _ -> failwith "bad symbol" in
  Position.{ symbol; qty; avg_entry_price = entry; current_price = current;
             strategy_id = strategy; opened_at = Time_utils.of_float now }

(* ---- Test PDT: 4th day trade on small account -> Reject ---- *)
let test_pdt_reject () =
  let tracker = Pdt_tracker.empty 1000.0 in
  let sym = match Symbol.create "AAPL" with Ok s -> s | Error _ -> failwith "bad" in
  let make_trade offset =
    Pdt_tracker.{ symbol = sym; date = now -. offset; strategy = Types.Mean_reversion }
  in
  (* Add 3 day trades *)
  let tracker = Pdt_tracker.add_trade tracker (make_trade 100000.0) in
  let tracker = Pdt_tracker.add_trade tracker (make_trade 200000.0) in
  let tracker = Pdt_tracker.add_trade tracker (make_trade 300000.0) in
  assert (not (Pdt_tracker.can_day_trade tracker));
  let config = Risk_config.default_for_phase Types.Micro in
  let portfolio = make_portfolio ~equity:1000.0 ~cash:500.0 ~positions:[] in
  let signal = make_signal "AAPL" in
  let result = Risk.evaluate
    ~config ~portfolio ~signal ~pdt:tracker ~phase:Types.Micro
    ~last_heartbeat:now ~current_time:now
    ~daily_pnl:Money.zero ~peak_equity:(Money.of_float 1000.0)
  in
  (match result with
   | Types.Reject _ -> ()
   | _ -> failwith "PDT test: expected Reject");
  Js.log "PASS: PDT 4th day trade rejected"

(* ---- Test phase: momentum at Micro -> Reject ---- *)
let test_momentum_micro_reject () =
  let config = Risk_config.default_for_phase Types.Micro in
  let portfolio = make_portfolio ~equity:2000.0 ~cash:1000.0 ~positions:[] in
  let signal = make_signal ~strategy:Types.Momentum "TSLA" in
  let pdt = Pdt_tracker.empty 2000.0 in
  let result = Risk.evaluate
    ~config ~portfolio ~signal ~pdt ~phase:Types.Micro
    ~last_heartbeat:now ~current_time:now
    ~daily_pnl:Money.zero ~peak_equity:(Money.of_float 2000.0)
  in
  (match result with
   | Types.Reject _ -> ()
   | _ -> failwith "Momentum/Micro test: expected Reject");
  Js.log "PASS: Momentum signal rejected at Micro phase"

(* ---- Test drawdown: -10% -> Reduce_size, -20% -> Flatten_all ---- *)
let test_drawdown_reduce () =
  let config = Risk_config.default_for_phase Types.Standard in
  let portfolio = make_portfolio ~equity:9000.0 ~cash:4500.0 ~positions:[] in
  let signal = make_signal "SPY" in
  let pdt = Pdt_tracker.empty 9000.0 in
  let result = Risk.evaluate
    ~config ~portfolio ~signal ~pdt ~phase:Types.Standard
    ~last_heartbeat:now ~current_time:now
    ~daily_pnl:Money.zero ~peak_equity:(Money.of_float 10000.0)
  in
  (match result with
   | Types.Reduce_size _ -> ()
   | _ -> failwith "Drawdown 10% test: expected Reduce_size");
  Js.log "PASS: 10% drawdown triggers Reduce_size"

let test_drawdown_flatten () =
  let config = Risk_config.default_for_phase Types.Standard in
  let portfolio = make_portfolio ~equity:8000.0 ~cash:4000.0 ~positions:[] in
  let signal = make_signal "SPY" in
  let pdt = Pdt_tracker.empty 8000.0 in
  let result = Risk.evaluate
    ~config ~portfolio ~signal ~pdt ~phase:Types.Standard
    ~last_heartbeat:now ~current_time:now
    ~daily_pnl:Money.zero ~peak_equity:(Money.of_float 10000.0)
  in
  (match result with
   | Types.Flatten_all _ -> ()
   | _ -> failwith "Drawdown 20% test: expected Flatten_all");
  Js.log "PASS: 20% drawdown triggers Flatten_all"

(* ---- Test position limit: >15% single position -> Reject ---- *)
let test_position_limit () =
  let config = Risk_config.default_for_phase Types.Standard in
  let portfolio = make_portfolio ~equity:100000.0 ~cash:50000.0 ~positions:[] in
  let signal = make_signal ~max_position_pct:0.20 "AAPL" in
  let pdt = Pdt_tracker.empty 100000.0 in
  let result = Risk.evaluate
    ~config ~portfolio ~signal ~pdt ~phase:Types.Standard
    ~last_heartbeat:now ~current_time:now
    ~daily_pnl:Money.zero ~peak_equity:(Money.of_float 100000.0)
  in
  (match result with
   | Types.Reject _ -> ()
   | _ -> failwith "Position limit test: expected Reject");
  Js.log "PASS: >15% position size rejected"

(* ---- Test heartbeat: missed for >15s -> Kill_switch ---- *)
let test_heartbeat_kill () =
  let config = Risk_config.default_for_phase Types.Standard in
  let portfolio = make_portfolio ~equity:50000.0 ~cash:25000.0 ~positions:[] in
  let signal = make_signal "MSFT" in
  let pdt = Pdt_tracker.empty 50000.0 in
  let stale_heartbeat = now -. 20000.0 in  (* 20 seconds ago *)
  let result = Risk.evaluate
    ~config ~portfolio ~signal ~pdt ~phase:Types.Standard
    ~last_heartbeat:stale_heartbeat ~current_time:now
    ~daily_pnl:Money.zero ~peak_equity:(Money.of_float 50000.0)
  in
  (match result with
   | Types.Kill_switch _ -> ()
   | _ -> failwith "Heartbeat test: expected Kill_switch");
  Js.log "PASS: Heartbeat timeout triggers Kill_switch"

(* ---- Run all tests ---- *)
let () =
  Js.log "Running risk engine tests...";
  test_pdt_reject ();
  test_momentum_micro_reject ();
  test_drawdown_reduce ();
  test_drawdown_flatten ();
  test_position_limit ();
  test_heartbeat_kill ();
  Js.log "All risk engine tests passed!"
