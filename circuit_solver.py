#!/usr/bin/env python3
"""
circuit_solver.py — Symbolic circuit solver for CircuitsPractice
=================================================================
Supports: R, C, L, V, I, O (ideal op-amp), E (VCVS), G (VCCS), H (CCVS), F (CCCS)

NETLIST FORMAT (one element per line, # for comments):
  V  name  n+  n-              independent voltage source
  I  name  n+  n-              independent current source (into n+)
  R  name  n+  n-              resistor
  C  name  n+  n-              capacitor  (s-domain, Y = sC)
  L  name  n+  n-              inductor   (s-domain, Y = 1/sL)
  O  name  vp  vm  vout        ideal op-amp (virtual short vp=vm, free Iout)
  E  name  n+  n-  nc+  nc-   VCVS: V(n+)-V(n-) = gain_E * (V(nc+)-V(nc-))
  G  name  n+  n-  nc+  nc-   VCCS: I(n+→n-) = gm_G * (V(nc+)-V(nc-))
  H  name  n+  n-  Vsense      CCVS: V(n+)-V(n-) = rm_H * I(Vsense)
  F  name  n+  n-  Vsense      CCCS: I(n+→n-) = beta_F * I(Vsense)

For H and F: Vsense must be a V element already in the netlist (acts as ammeter).
Gain symbols are named gain_E, gm_G, rm_H, beta_F by default — rename freely.
Node "0" is always ground.

EXAMPLES:

  FET small-signal (VCCS):
    V Vin 1 0
    G Gm 3 0 1 0    # drain current = gm * Vgs; gm_Gm is the symbol
    R RD 3 0

  BJT small-signal (VCCS + CCCS):
    V Vb 1 0
    R rb 1 2
    G Gm 3 0 2 0    # Ic = gm*Vbe
    R RC 3 0
    R RE 0 3

  Transresistance amp (CCVS):
    I Is 0 1
    V Vsense 1 2    # ammeter in series
    R Rin 2 0
    H Hrm 3 0 Vsense  # Vout = rm * I_Vsense
    R RL 3 0

  Current mirror (CCCS):
    I Is 0 1
    V Vsense 1 2
    R R1 2 0
    F Fbeta 3 0 Vsense  # I_out = beta * I_Vsense
    R RL 3 0

  Op-amp with finite gain (VCVS):
    V Vin 1 0
    R R1 0 2
    R Rf 2 3
    E Eamp 3 0 1 2   # Vout = gain_Eamp * (Vin - V2)
"""

import sys
from sympy import symbols, Symbol, solve, simplify, factor, zeros


# ── Parser ─────────────────────────────────────────────────────────────────────

def parse_netlist(text: str):
    elements = []
    for raw in text.strip().splitlines():
        line = raw.split('#')[0].strip()
        if not line:
            continue
        parts = line.split()
        etype = parts[0].upper()

        if etype == 'O':
            if len(parts) < 5:
                print(f"  [skip] O needs: name vp vm vout — got: {raw!r}")
                continue
            elements.append({'type':'O','name':parts[1],
                             'vp':parts[2],'vm':parts[3],'vout':parts[4],
                             'np':parts[2],'nm':parts[3]})

        elif etype in ('E','G'):
            # E/G: name n+ n- nc+ nc-
            if len(parts) < 6:
                print(f"  [skip] {etype} needs: name n+ n- nc+ nc- — got: {raw!r}")
                continue
            elements.append({'type':etype,'name':parts[1],
                             'np':parts[2],'nm':parts[3],
                             'ncp':parts[4],'ncm':parts[5]})

        elif etype in ('H','F'):
            # H/F: name n+ n- Vsense_name
            if len(parts) < 5:
                print(f"  [skip] {etype} needs: name n+ n- Vsense — got: {raw!r}")
                continue
            elements.append({'type':etype,'name':parts[1],
                             'np':parts[2],'nm':parts[3],
                             'vsense':parts[4]})

        else:
            if len(parts) < 4:
                print(f"  [skip] {raw!r}")
                continue
            elements.append({'type':etype,'name':parts[1],
                             'np':parts[2],'nm':parts[3]})

    # Component value symbols: passives + independent sources + gain params
    # (not op-amp names, not sense-source references)
    sym_names = set()
    for e in elements:
        if e['type'] in ('R','C','L','V','I'):
            sym_names.add(e['name'])
        elif e['type'] in ('E','G','H','F'):
            # Gain symbol named  gain_<name>, gm_<name>, rm_<name>, beta_<name>
            prefix = {'E':'gain','G':'gm','H':'rm','F':'beta'}[e['type']]
            sym_names.add(f"{prefix}_{e['name']}")

    return elements, sym_names


# ── MNA builder ───────────────────────────────────────────────────────────────

def build_mna(elements, sym_names):
    """
    Unknowns: [V_node...] + [I_Vsrc...] + [I_OpAmp...] + [I_VCVS...] + [I_CCVS...]
    Extra rows (one per):
      V source  → KVL: V_n+ - V_n- = Vs
      Op-amp    → virtual short: V_vp - V_vm = 0
      E (VCVS)  → KVL: V_n+ - V_n- = gain*(V_nc+ - V_nc-)
      H (CCVS)  → KVL: V_n+ - V_n- = rm * I_Vsense
    G and F stamp directly into existing rows (no extra variable).
    """

    # ── Collect nodes ──────────────────────────────────────────────────────────
    node_set = []
    def _add(n):
        if n != '0' and n not in node_set:
            node_set.append(n)

    for e in elements:
        _add(e['np']); _add(e['nm'])
        if e['type'] == 'O': _add(e['vout'])
        if e['type'] in ('E','G'): _add(e.get('ncp','')); _add(e.get('ncm',''))

    n_nodes = len(node_set)

    # ── Elements that add extra variables ──────────────────────────────────────
    vsrcs  = [e for e in elements if e['type'] == 'V']
    opamps = [e for e in elements if e['type'] == 'O']
    vcvs   = [e for e in elements if e['type'] == 'E']
    ccvs   = [e for e in elements if e['type'] == 'H']

    extra = vsrcs + opamps + vcvs + ccvs
    size  = n_nodes + len(extra)

    # ── SymPy symbols ──────────────────────────────────────────────────────────
    syms = {name: Symbol(name, positive=True) for name in sym_names}
    syms['s'] = Symbol('s')
    # Gain symbols can be negative (e.g. inverting), use general real symbols
    for name in sym_names:
        if any(name.startswith(p) for p in ('gain_','gm_','rm_','beta_')):
            syms[name] = Symbol(name)   # real, not positive

    def ni(n):
        return node_set.index(n) if n in node_set else -1

    # Extra row/col index map
    extra_idx = {}
    for k, e in enumerate(extra):
        extra_idx[(e['type'], e['name'])] = n_nodes + k

    # Lookup I_Vsense column for H/F elements
    def vsense_col(vsense_name):
        return extra_idx.get(('V', vsense_name), None)

    A     = zeros(size, size)
    b_vec = zeros(size, 1)

    # ── Stamp each element ─────────────────────────────────────────────────────
    for e in elements:
        t    = e['type']
        name = e['name']
        pi   = ni(e['np'])
        mi   = ni(e['nm'])

        # ── Passives ───────────────────────────────────────────────────────────
        if t in ('R','C','L'):
            sym = syms[name]
            if   t == 'R': g = 1 / sym
            elif t == 'C': g = syms['s'] * sym
            elif t == 'L': g = 1 / (syms['s'] * sym)
            if pi >= 0: A[pi, pi] += g
            if mi >= 0: A[mi, mi] += g
            if pi >= 0 and mi >= 0:
                A[pi, mi] -= g
                A[mi, pi] -= g

        # ── Independent voltage source ─────────────────────────────────────────
        elif t == 'V':
            vi = extra_idx[('V', name)]
            if pi >= 0: A[pi, vi] += 1
            if mi >= 0: A[mi, vi] -= 1
            if pi >= 0: A[vi, pi] += 1
            if mi >= 0: A[vi, mi] -= 1
            b_vec[vi] += syms[name]

        # ── Independent current source ─────────────────────────────────────────
        elif t == 'I':
            if pi >= 0: b_vec[pi] += syms[name]
            if mi >= 0: b_vec[mi] -= syms[name]

        # ── Ideal op-amp ───────────────────────────────────────────────────────
        elif t == 'O':
            vp_i   = ni(e['vp'])
            vm_i   = ni(e['vm'])
            vout_i = ni(e['vout'])
            oi     = extra_idx[('O', name)]
            if vout_i >= 0: A[vout_i, oi] += 1
            if vp_i  >= 0: A[oi, vp_i]   += 1
            if vm_i  >= 0: A[oi, vm_i]   -= 1

        # ── VCVS (E): V(n+)-V(n-) = gain*(V(nc+)-V(nc-)) ─────────────────────
        elif t == 'E':
            vi   = extra_idx[('E', name)]
            gain = syms[f'gain_{name}']
            ncp  = ni(e['ncp']); ncm = ni(e['ncm'])
            # KCL: I_E flows into n+, out of n-
            if pi  >= 0: A[pi,  vi] += 1
            if mi  >= 0: A[mi,  vi] -= 1
            # KVL row: V_n+ - V_n- - gain*(V_nc+ - V_nc-) = 0
            if pi  >= 0: A[vi, pi]  += 1
            if mi  >= 0: A[vi, mi]  -= 1
            if ncp >= 0: A[vi, ncp] -= gain
            if ncm >= 0: A[vi, ncm] += gain

        # ── VCCS (G): I = gm*(V(nc+)-V(nc-)), no extra variable ───────────────
        elif t == 'G':
            gm  = syms[f'gm_{name}']
            ncp = ni(e['ncp']); ncm = ni(e['ncm'])
            # KCL: gm*V_nc+ flows into n+, gm*V_nc- flows out
            if pi >= 0 and ncp >= 0: A[pi, ncp] += gm
            if pi >= 0 and ncm >= 0: A[pi, ncm] -= gm
            if mi >= 0 and ncp >= 0: A[mi, ncp] -= gm
            if mi >= 0 and ncm >= 0: A[mi, ncm] += gm
            # If nc+ or nc- is ground (index=-1), no stamp needed (V=0)

        # ── CCVS (H): V(n+)-V(n-) = rm * I_Vsense ────────────────────────────
        elif t == 'H':
            vi   = extra_idx[('H', name)]
            rm   = syms[f'rm_{name}']
            vcol = vsense_col(e['vsense'])
            # KCL: I_H flows into n+, out of n-
            if pi >= 0: A[pi, vi] += 1
            if mi >= 0: A[mi, vi] -= 1
            # KVL row: V_n+ - V_n- - rm * I_Vsense = 0
            if pi >= 0: A[vi, pi] += 1
            if mi >= 0: A[vi, mi] -= 1
            if vcol is not None: A[vi, vcol] -= rm

        # ── CCCS (F): I = beta * I_Vsense, no extra variable ──────────────────
        elif t == 'F':
            beta = syms[f'beta_{name}']
            vcol = vsense_col(e['vsense'])
            if vcol is None:
                print(f"  [warn] CCCS {name}: sense source '{e['vsense']}' not found")
                continue
            # KCL: beta * I_Vsense flows into n+, out of n-
            if pi >= 0: A[pi, vcol] += beta
            if mi >= 0: A[mi, vcol] -= beta

    # ── Unknown labels ─────────────────────────────────────────────────────────
    unknowns = (
        [Symbol(f'V_{n}')         for n in node_set] +
        [Symbol(f'I_{e["name"]}') for e in vsrcs]    +
        [Symbol(f'I_{e["name"]}') for e in opamps]   +
        [Symbol(f'I_{e["name"]}') for e in vcvs]     +
        [Symbol(f'I_{e["name"]}') for e in ccvs]
    )

    return A, b_vec, unknowns, node_set, vsrcs, opamps, vcvs, ccvs, syms


# ── Time-domain conversion ────────────────────────────────────────────────────

def has_s(expr):
    """True if expression contains the Laplace variable s."""
    from sympy import Symbol
    s = Symbol('s')
    return expr.has(s)


def to_time_domain(expr_s, elements):
    """
    Convert an s-domain MNA output to the step-response time-domain expression.

    MNA stamps DC sources as constants (Vs, not Vs/s), so s-domain results
    are transfer functions H(s). Multiply by 1/s before ILT to get step response:
        v(t) = ILT{ H(s)/s }

    Unit convention: the symbolic component values (R, C, L) carry implicit
    editor units (kΩ, μF, mH). The key insight is that τ = R×C has units of
    kΩ×μF = ms, matching the editor's time variable t [ms]. So we use t
    directly as the ILT variable — no conversion factor needed. The resulting
    formulas like Vs*(1 - exp(-t/(R*C))) are correct when:
        t  in ms,  R in kΩ,  C in μF,  L in mH
    """
    from sympy import inverse_laplace_transform, Symbol, simplify, factor

    s = Symbol('s')
    t = Symbol('t', positive=True)   # editor's time variable [ms]

    # Multiply by 1/s to get step response from transfer function
    expr_step = expr_s / s

    try:
        expr_t = inverse_laplace_transform(expr_step, s, t)
        expr_t = simplify(expr_t)
    except Exception as exc:
        return None, f"ILT failed: {exc}"

    return expr_t, None


# ── Solver ────────────────────────────────────────────────────────────────────

def solve_circuit(netlist_text: str, verbose=True, time_domain=True):
    if verbose:
        print("=" * 60)
        print("CIRCUIT SOLVER")
        print("=" * 60)

    elements, sym_names = parse_netlist(netlist_text)
    if not elements:
        print("No elements parsed."); return {}

    if verbose:
        print(f"\nElements ({len(elements)}):")
        for e in elements:
            et = e['type']
            if et == 'O':
                print(f"  O  {e['name']}  (vp={e['vp']}, vm={e['vm']}, vout={e['vout']})")
            elif et in ('E','G'):
                print(f"  {et}  {e['name']}  ({e['np']}→{e['nm']}) ctrl({e['ncp']}→{e['ncm']})")
            elif et in ('H','F'):
                print(f"  {et}  {e['name']}  ({e['np']}→{e['nm']}) sense={e['vsense']}")
            else:
                print(f"  {et}  {e['name']}  ({e['np']}→{e['nm']})")

    A, b_vec, unknowns, node_list, vsrcs, opamps, vcvs, ccvs, syms = \
        build_mna(elements, sym_names)

    if verbose:
        print(f"\nNodes: {node_list}")
        print(f"Unknowns: {[str(u) for u in unknowns]}")

    try:
        sol_vec = A.solve(b_vec)
    except Exception as exc:
        print(f"\n[ERROR] {exc}")
        print("Check for floating nodes, missing feedback, or degenerate topology.")
        return {}

    solution = {}
    for i, u in enumerate(unknowns):
        solution[str(u)] = simplify(factor(sol_vec[i]))

    # ── Derived: branch currents ───────────────────────────────────────────────
    for e in elements:
        et = e['type']
        if et not in ('R','C','L'): continue
        np_, nm_ = e['np'], e['nm']
        Vp = solution.get(f'V_{np_}', 0) if np_ != '0' else 0
        Vm = solution.get(f'V_{nm_}', 0) if nm_ != '0' else 0
        sym = syms[e['name']]
        if   et == 'R': Ib = (Vp - Vm) / sym
        elif et == 'C': Ib = (Vp - Vm) * syms['s'] * sym
        elif et == 'L': Ib = (Vp - Vm) / (syms['s'] * sym)
        solution[f'I_{e["name"]}'] = simplify(factor(Ib))

    # ── Derived: resistor power ────────────────────────────────────────────────
    for e in elements:
        if e['type'] == 'R':
            I = solution.get(f'I_{e["name"]}')
            if I is not None:
                solution[f'P_{e["name"]}'] = simplify(factor(I**2 * syms[e['name']]))

    # ── Time-domain conversion ─────────────────────────────────────────────────
    has_reactive = any(e['type'] in ('C','L') for e in elements)
    time_solution = {}

    if time_domain and has_reactive:
        if verbose:
            print("\n[Time domain] Reactive elements detected — computing v(t), i(t)…")
        for key, expr in solution.items():
            if has_s(expr):
                expr_t, err = to_time_domain(expr, elements)
                if err:
                    if verbose: print(f"  {key}: {err}")
                elif expr_t is not None:
                    time_solution[f't_{key}'] = expr_t

    solution.update(time_solution)

    if verbose: _print_solution(solution, has_time=bool(time_solution))
    return solution


def _print_solution(solution, has_time=False):
    from sympy import printing
    print("\n" + "─" * 60)
    print("SYMBOLIC SOLUTION  (s-domain)")
    print("─" * 60)
    for prefix, cat in [('V_','Node Voltages'),('I_','Branch Currents'),('P_','Power')]:
        items = [(k,v) for k,v in solution.items()
                 if k.startswith(prefix) and not k.startswith('t_')]
        if not items: continue
        print(f"\n{cat}:")
        for k, v in items: print(f"  {k} = {v}")

    if has_time:
        print("\n" + "─" * 60)
        print("TIME-DOMAIN  v(t), i(t)  [t in ms, R in kΩ, C in μF, L in mH]")
        print("─" * 60)
        for k, v in solution.items():
            if not k.startswith('t_'): continue
            orig = k[2:]  # strip 't_'
            print(f"\n  {orig}(t) = {v}")

    print("\n" + "─" * 60)
    print("EDITOR FORMULA STRINGS")
    print("─" * 60)
    if has_time:
        print("  (t-domain formulas require 't' as a Var in the editor, unit: ms)\n")
    for name, expr in solution.items():
        js    = printing.jscode(expr)
        label = _label(name)
        unit  = _unit(name)
        is_time = name.startswith('t_')
        if is_time:
            orig  = name[2:]
            label = _label(orig) + " at time t"
            unit  = _unit(orig)
        print(f"  Label  : {label}")
        print(f"  Unit   : {unit}")
        print(f"  Formula: {js}")
        print()


def _label(s):
    if s.startswith('V_'): return f"Voltage at node {s[2:]}"
    if s.startswith('I_'):
        n = s[2:]
        if n[0].upper() == 'V': return f"Current through source {n}"
        if n[0].upper() == 'U': return f"Op-amp {n} output current"
        return f"Current through {n}"
    if s.startswith('P_'): return f"Power in {s[2:]}"
    return s

def _unit(s):
    if s.startswith('V_'): return 'V'
    if s.startswith('I_'): return 'mA'
    if s.startswith('P_'): return 'mW'
    return ''


# ── Examples ──────────────────────────────────────────────────────────────────

EXAMPLES = {
    "voltage_divider": """\
V Vs 1 0
R R1 1 2
R R2 2 0
""",
    "inverting_amp": """\
# Ideal op-amp inverting amplifier
V Vin 1 0
R Rin 1 2
R Rf 2 3
O U1 0 2 3
""",
    "fet_small_signal": """\
# FET common-source small-signal model (VCCS)
V Vin 1 0
G Gm 2 0 1 0
R RD 2 0
""",
    "bjt_small_signal": """\
# BJT common-emitter small-signal (VCCS for gm*Vbe, rpi at input)
V Vb 1 0
R rpi 1 2
G Gm 3 0 2 0
R RC 3 0
""",
    "transresistance": """\
# Transresistance amp (CCVS): Vout = rm * I_in
I Is 0 1
V Vsense 1 2
R Rin 2 0
H Hrm 3 0 Vsense
R RL 3 0
""",
    "current_mirror": """\
# CCCS current mirror: I_out = beta * I_in
I Is 0 1
V Vsense 1 2
R R1 2 0
F Fbeta 3 0 Vsense
R RL 3 0
""",
    "finite_gain_opamp": """\
# VCVS with finite gain A (noninverting config with feedback)
V Vin 1 0
R R1 0 2
R Rf 2 3
E Eamp 3 0 1 2
""",
    "integrator": """\
# Op-amp integrator (s-domain)
V Vin 1 0
R Rin 1 2
C Cf 2 3
O U1 0 2 3
""",
}


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            solve_circuit(f.read())
    else:
        for title, netlist in EXAMPLES.items():
            print(f"\n{'═'*60}")
            print(f"EXAMPLE: {title.upper().replace('_',' ')}")
            print(f"{'═'*60}")
            solve_circuit(netlist, verbose=True)

if __name__ == '__main__':
    main()
