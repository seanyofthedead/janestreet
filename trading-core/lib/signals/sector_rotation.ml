open Trading_core

(** Sector rotation strategy using dual momentum.
    Absolute momentum: positive trailing 6-month return (skip recent month).
    Relative momentum: pick top 2 sectors by 6m return minus 1m return.
    If all sectors negative, rotate into cash proxy (BND). *)

type sector_input = {
  symbol: string;
  return_6m: float;
  return_1m: float;
}

(** The 11 SPDR sector ETFs *)
let sector_etfs =
  [| "XLK"; "XLF"; "XLE"; "XLV"; "XLI"; "XLU"; "XLC"; "XLP"; "XLB"; "XLRE"; "XLY" |]

(** Compute formation return: 6-month minus most recent month *)
let formation_return (s : sector_input) =
  s.return_6m -. s.return_1m

(** Generate rotation signals.
    @param sectors          array of sector return data
    @param is_month_end     true if this is the last trading day of the month
    @param now              current timestamp
    Returns a list of Signal.t for the rotation. *)
let generate ~(sectors : sector_input array) ~is_month_end ~now =
  if not is_month_end then []
  else
    (* Step 1: absolute momentum filter — keep only positive formation returns *)
    let with_formation =
      Array.to_list sectors
      |> List.map (fun s -> (s, formation_return s))
    in
    let positive =
      List.filter (fun (_, fr) -> fr > 0.0) with_formation
    in
    let make_signal sym side conf =
      let s = match Symbol.create sym with Ok s -> s | Error _ -> sym in
      let strength =
        if conf > 0.8 then Types.Strong conf
        else if conf > 0.5 then Types.Moderate conf
        else Types.Weak conf
      in
      ({ Signal.strategy = Types.Sector_rotation;
         symbol = s;
         side;
         strength;
         target_price = 0.0;  (* rotation signals don't target a price *)
         max_position_pct = 0.15;
         timestamp = now;
       } : Signal.t)
    in
    if List.length positive = 0 then
      (* All sectors negative — go to cash proxy *)
      [ make_signal "BND" Types.Buy 0.6 ]
    else
      (* Step 2: relative momentum — sort by formation return, pick top 2 *)
      let sorted =
        List.sort (fun (_, fr1) (_, fr2) -> Float.compare fr2 fr1) positive
      in
      let top_n = List.filteri (fun i _ -> i < 2) sorted in
      (* Confidence: normalize by max formation return *)
      let max_fr =
        match top_n with
        | (_, fr) :: _ -> Float.max fr 0.01
        | [] -> 0.01
      in
      List.map (fun (s, fr) ->
        let conf = Float.min 1.0 (0.5 +. 0.5 *. fr /. max_fr) in
        make_signal s.symbol Types.Buy conf
      ) top_n

(** Check if a symbol is a recognized sector ETF *)
let is_sector_etf sym =
  Array.exists (fun s -> String.equal s sym) sector_etfs
