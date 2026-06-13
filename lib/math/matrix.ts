/** Tiny fixed-size linear-algebra helpers (no deps) for covariance math. */

export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number
];

export type Mat2 = [number, number, number, number]; // row-major [a,b,c,d]

/** Multiply two 3x3 matrices (row-major). */
export function mul3(A: Mat3, B: Mat3): Mat3 {
  const r = new Array(9).fill(0) as number[];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return r as Mat3;
}

/** Transpose a 3x3 matrix. */
export function transpose3(A: Mat3): Mat3 {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}

/** Build a diagonal 3x3 matrix. */
export function diag3(a: number, b: number, c: number): Mat3 {
  return [a, 0, 0, 0, b, 0, 0, 0, c];
}

/** 2x2 determinant. */
export function det2(M: Mat2): number {
  return M[0] * M[3] - M[1] * M[2];
}

/** 2x2 inverse. Returns null if singular. */
export function inv2(M: Mat2): Mat2 | null {
  const d = det2(M);
  if (Math.abs(d) < 1e-300) return null;
  const inv = 1 / d;
  return [M[3] * inv, -M[1] * inv, -M[2] * inv, M[0] * inv];
}

/** Quadratic form x^T M x for a 2-vector and 2x2 matrix. */
export function quad2(M: Mat2, x: [number, number]): number {
  return (
    M[0] * x[0] * x[0] +
    (M[1] + M[2]) * x[0] * x[1] +
    M[3] * x[1] * x[1]
  );
}
