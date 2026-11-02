package com.calculator.operation;

import com.calculator.exception.DivisionByZeroException;

/** Divides the left operand by the right operand. */
public class Division implements Operation {

    @Override
    public double apply(double left, double right) {
        if (right == 0) {
            throw new DivisionByZeroException();
        }
        return left / right;
    }

    @Override
    public String symbol() {
        return "/";
    }

    @Override
    public String name() {
        return "Division";
    }
}
