package com.calculator.operation;

import com.calculator.exception.DivisionByZeroException;

/** Returns the remainder of dividing the left operand by the right operand. */
public class Modulus implements Operation {

    @Override
    public double apply(double left, double right) {
        if (right == 0) {
            throw new DivisionByZeroException("Cannot take modulus with a divisor of zero.");
        }
        return left % right;
    }

    @Override
    public String symbol() {
        return "%";
    }

    @Override
    public String name() {
        return "Modulus";
    }
}
