(lang dune 3.20)
(using melange 1.0)

(name trading_core)

(generate_opam_files true)

(source (github user/janestreet-trading))
(license MIT)

(package
 (name trading_core)
 (synopsis "Autonomous multi-strategy trading agent - OCaml core")
 (depends
  (ocaml (>= 5.4))
  (melange (>= 6.0))
  (dune (>= 3.20))))
